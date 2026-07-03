# Cedar Policy Architecture

## Overview

The Cost Optimizer uses Amazon Bedrock AgentCore Policy Engine with Cedar policies
to govern remediation actions. Policies are deployed via CloudFormation in `remediator-gateway-stack.ts`
and evaluated natively by AgentCore at the Gateway level.

Authorization decisions combine **role-based access control** (from JWT claims) with
**risk-based access control** (from the `context.riskLevel` attribute injected by the
Risk Level Interceptor Lambda).

## Architecture

```
User (JWT) -> Remediator Gateway -> Risk Level Interceptor -> Cedar Policy Engine -> Lambda Target
                                          |                          |
                                   DynamoDB Lookup             ALLOW / DENY
                                   (Risk Mapping Table)
```

The Risk Level Interceptor Lambda executes before Cedar policy evaluation. It queries
the Risk Mapping Table (DynamoDB) to resolve the risk level for the requested action,
then injects `context.riskLevel` into the authorization context.

The Remediator Gateway (`costopt-remediator-gw`) exposes 7 Lambda functions as targets.
Each target registers one tool, creating Cedar actions in the format:

```
AgentCore::Action::"{targetName}___{toolName}"
```

## Action Mapping

| Target Name | Tool Name          | Cedar Action                          | Risk Level |
|-------------|--------------------|---------------------------------------|------------|
| resize      | resize_instance    | resize___resize_instance              | Low        |
| storage     | modify_storage     | storage___modify_storage              | Low        |
| tag         | add_tag            | tag___add_tag                         | Low        |
| stop        | stop_instance      | stop___stop_instance                  | Medium     |
| snapshot    | delete_snapshot    | snapshot___delete_snapshot            | Medium     |
| terminate   | terminate_instance | terminate___terminate_instance        | High       |
| volume      | delete_ebs_volume  | volume___delete_ebs_volume            | High       |

## Risk Level Context Attribute

The `context.riskLevel` attribute is a string value injected into the Cedar authorization
context by the Risk Level Interceptor Lambda. It represents the risk classification of
the requested action.

**Valid values:** `"low"`, `"medium"`, `"high"`

**Source of truth:** The Risk Mapping Table (`CostOptRiskMappings` DynamoDB table) stores
the authoritative mapping between action keys and their risk levels. See the
[Risk Mapping Table](#risk-mapping-table) section below.

**Fail-closed behavior:** If the Risk Mapping Table is unreachable or the action key is
not found, the interceptor defaults to `"high"` risk level. This ensures that unknown
or unmapped actions are treated with maximum caution.

### How context.riskLevel is used in Cedar

Cedar policies reference the risk level via `context.riskLevel` in `when` clauses:

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action in [...],
  resource == AgentCore::Gateway::"{gateway_arn}"
)
when {
  principal.hasTag("cognito:groups") &&
  principal.getTag("cognito:groups") like "*Engineer*" &&
  context.riskLevel == "low"
};
```

## Authorization Matrix (Role x Risk Level)

| Role     | Low Risk | Medium Risk | High Risk |
|----------|----------|-------------|-----------|
| Engineer | ALLOW    | ALLOW       | DENY      |
| Manager  | ALLOW    | ALLOW       | ALLOW     |
| Analyst  | DENY     | DENY        | DENY      |

**Notes:**
- Engineers can execute low and medium risk actions but are explicitly denied high-risk actions.
- Managers have unrestricted access at the Cedar gateway level. HITL (Human-in-the-Loop) approval for high-risk actions is enforced at the Remediator runtime level.
- Analysts have no permit policies, so Cedar's default-deny behavior blocks all actions.

## Cedar Policies (deployed)

### permit_low_risk

Allows low-risk remediation actions (resize, modify_storage, add_tag) for Engineer and
Manager roles when `context.riskLevel` is `"low"`.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action in [
    AgentCore::Action::"resize___resize_instance",
    AgentCore::Action::"storage___modify_storage",
    AgentCore::Action::"tag___add_tag"
  ],
  resource == AgentCore::Gateway::"{gateway_arn}"
)
when {
  principal.hasTag("cognito:groups") &&
  (principal.getTag("cognito:groups") like "*Engineer*" ||
   principal.getTag("cognito:groups") like "*Manager*") &&
  context.riskLevel == "low"
};
```

### permit_medium_risk

Allows medium-risk actions (stop_instance, delete_snapshot) for Engineer and Manager
roles when `context.riskLevel` is `"medium"`.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action in [
    AgentCore::Action::"stop___stop_instance",
    AgentCore::Action::"snapshot___delete_snapshot"
  ],
  resource == AgentCore::Gateway::"{gateway_arn}"
)
when {
  principal.hasTag("cognito:groups") &&
  (principal.getTag("cognito:groups") like "*Engineer*" ||
   principal.getTag("cognito:groups") like "*Manager*") &&
  context.riskLevel == "medium"
};
```

### permit_high_risk

Allows high-risk actions (terminate_instance, delete_ebs_volume) only for Manager role
when `context.riskLevel` is `"high"`. HITL approval is enforced at the Remediator
runtime level, not at Cedar.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action in [
    AgentCore::Action::"terminate___terminate_instance",
    AgentCore::Action::"volume___delete_ebs_volume"
  ],
  resource == AgentCore::Gateway::"{gateway_arn}"
)
when {
  principal.hasTag("cognito:groups") &&
  principal.getTag("cognito:groups") like "*Manager*" &&
  context.riskLevel == "high"
};
```

### deny_high_risk_engineer

Explicitly denies high-risk actions for Engineer role. Cedar evaluates `forbid` policies
before `permit`, ensuring Engineers cannot execute high-risk actions regardless of other
policies.

```cedar
forbid(
  principal is AgentCore::OAuthUser,
  action in [
    AgentCore::Action::"terminate___terminate_instance",
    AgentCore::Action::"volume___delete_ebs_volume"
  ],
  resource == AgentCore::Gateway::"{gateway_arn}"
)
when {
  principal.hasTag("cognito:groups") &&
  principal.getTag("cognito:groups") like "*Engineer*" &&
  !(principal.getTag("cognito:groups") like "*Manager*") &&
  context.riskLevel == "high"
};
```

## Risk Mapping Table

The Risk Mapping Table (`CostOptRiskMappings`) is the single source of truth for
action-to-risk-level mappings. Both the Risk Level Interceptor Lambda and the
Policy Engine Module read from this table.

**Table schema:**

| Attribute | Type   | Description                                    |
|-----------|--------|------------------------------------------------|
| action (PK) | String | Composite key: `{targetName}___{toolName}`   |
| target    | String | Tool name (e.g., `terminate_instance`)         |
| riskLevel | String | One of: `low`, `medium`, `high`                |

**Initial seed data:**

| action                            | target             | riskLevel |
|-----------------------------------|--------------------|-----------|
| resize___resize_instance          | resize_instance    | low       |
| storage___modify_storage          | modify_storage     | low       |
| tag___add_tag                     | add_tag            | low       |
| stop___stop_instance              | stop_instance      | medium    |
| snapshot___delete_snapshot        | delete_snapshot    | medium    |
| terminate___terminate_instance    | terminate_instance | high      |
| volume___delete_ebs_volume        | delete_ebs_volume  | high      |

**Updating risk levels:** To change the risk classification of an action, update the
`riskLevel` attribute in the DynamoDB table. The change takes effect on the next
authorization request (interceptor) or after cache expiry (policy engine module,
default 300 seconds TTL).

**Adding new actions:** Insert a new record with the action key, target, and desired
risk level. No code deployment is required.

## Two-Layer Authorization

Authorization is enforced at two levels:

1. **AgentCore Policy Engine (Cedar)** - Gateway level
   - Evaluates permit/deny based on JWT identity, action, AND `context.riskLevel`
   - Risk level injected by the Risk Level Interceptor Lambda
   - Managed via CloudFormation (`remediator-gateway-stack.ts`)
   - Fail-closed: if no policy matches, action is denied
   - Fail-closed: if risk level lookup fails, defaults to "high"

2. **Remediator Runtime (Python)** - Application level (`policy_engine.py`)
   - Role-based access control (analyst/engineer/manager)
   - Dynamic risk classification from DynamoDB (with cache + env var fallback)
   - Environment-aware (production resources protected)
   - Critical resource protection (DoNotModify tag)
   - Risk classification triggers HITL for high-risk actions

This dual-layer approach provides defense-in-depth:
- Cedar at Gateway prevents unauthorized tool invocations using role + risk level
- Python policy engine adds business logic (environment, criticality, HITL)
- Both layers use the same Risk Mapping Table as source of truth

## Entity Model (AgentCore namespace)

AgentCore uses its own Cedar namespace internally:

- **Principal**: `AgentCore::OAuthUser` (derived from JWT claims)
- **Action**: `AgentCore::Action::"{target}___{tool}"` (auto-registered from Gateway targets)
- **Resource**: `AgentCore::Gateway::"{gateway_arn}"` (the Gateway itself)
- **Context**: `context.riskLevel` (injected by Risk Level Interceptor)

## Deployed Resources

| Resource | ID |
|----------|-----|
| Policy Engine | `costopt_policy_engine-XXXXX` |
| Remediator Gateway | `costopt-remediator-gw-XXXXX` |
| Gateway ARN | `arn:aws:bedrock-agentcore:us-east-1:ACCOUNT_ID:gateway/costopt-remediator-gw-XXXXX` |
| Risk Mapping Table | `CostOptRiskMappings` |
| Risk Level Interceptor | `CostOptRiskInterceptor` |
