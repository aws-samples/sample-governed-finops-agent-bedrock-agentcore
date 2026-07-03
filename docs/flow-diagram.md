# AgentCore Cost Optimizer - Flujo Completo

## Flujo Simplificado

```mermaid
flowchart TD
    User([Usuario]) --> Chat[Chat con el Agente]
    Chat --> Recommend[Agente analiza costos<br/>via MCP Tools]
    Recommend --> Show[Muestra recomendaciones<br/>con savings y riesgo]
    Show --> Execute{Usuario ejecuta<br/>una accion}

    Execute --> Policy[Policy Engine<br/>evalua la accion]

    Policy -->|Low/Medium Risk<br/>+ permisos OK| Allow[ALLOW<br/>Ejecuta Lambda]
    Policy -->|High Risk| HITL[REQUIRES_APPROVAL<br/>Email al approver]
    Policy -->|Sin permisos| Deny[DENY<br/>Accion bloqueada]

    Allow --> Done([Accion completada])
    Deny --> Blocked([Acceso denegado])

    HITL --> Wait{Approver responde}
    Wait -->|Aprueba| ExecLambda[Ejecuta Lambda]
    Wait -->|Rechaza| Rejected([Accion rechazada])
    Wait -->|24h sin respuesta| Expired([Request expirado])
    ExecLambda --> Done
```

## Diagrama de Secuencia End-to-End

```mermaid
sequenceDiagram
    participant U as Usuario (Frontend)
    participant Cognito as Amazon Cognito<br/>(costopt-users)
    participant R1 as Recommender Runtime<br/>(costopt_runtime)
    participant GW1 as Cost Optimizer Gateway<br/>(costopt-gateway)
    participant MCP_B as Billing MCP Runtime<br/>(costopt_billing_mcp_v1)
    participant MCP_P as Pricing MCP Runtime<br/>(costopt_pricing_mcp_v1)
    participant Bedrock as Amazon Bedrock<br/>(Claude Sonnet 4)
    participant R2 as Remediator Runtime<br/>(costopt_remediator)
    participant GW2 as Remediator Gateway<br/>(costopt-remediator-gw)
    participant Cedar as Cedar Policy Engine<br/>(costopt_policy_engine)
    participant Lambda as Remediation Lambdas
    participant DDB as DynamoDB<br/>(ApprovalRequests)
    participant SNS as Amazon SNS
    participant Approver as Approver (Email)
    participant APIGW as API Gateway<br/>(Approval URLs)
    participant LApproval as Lambda<br/>(approval_handler)

    Note over U,Cognito: FASE 1: Autenticacion
    U->>Cognito: Login (email + password)
    Cognito-->>U: idToken (con cognito:groups) + accessToken + credentials

    Note over U,Bedrock: FASE 2: Chat - Recomendaciones
    U->>R1: POST /invocations (prompt + jwt_token + sessionId)
    R1->>R1: extract JWT, get user identity
    R1->>GW2: MCP tools/list (fetch available actions)
    GW2-->>R1: [resize_instance, stop_instance, terminate_instance,<br/>modify_storage, add_tag, delete_snapshot, delete_ebs_volume]
    R1->>R1: build_system_prompt(available_actions)
    R1->>GW1: MCP connection (JWT Bearer auth)
    GW1->>GW1: Validate JWT (Cognito OIDC discovery)
    GW1->>MCP_B: Forward request (OAuth M2M token)
    MCP_B->>MCP_B: AWS Cost Explorer API / Compute Optimizer
    MCP_B-->>GW1: Cost data + recommendations
    GW1-->>R1: MCP tool results
    R1->>Bedrock: Prompt + tool results + system prompt
    Bedrock-->>R1: Structured response with recommendations
    R1-->>U: Recommendations (action, resource, savings, risk)

    Note over U,Lambda: FASE 3A: Ejecucion - Accion Low/Medium Risk
    U->>R2: POST /invocations (action_type=resize_instance,<br/>resource_id, jwt_token)
    R2->>R2: extract_identity(idToken)<br/>role=manager, email=user@example.com
    R2->>R2: get_resource_context(resource_id)<br/>environment, tags, is_critical
    R2->>R2: policy.authorize()<br/>Rule 1: not analyst ✓<br/>Rule 2: action in allowed ✓<br/>Rule 3: not critical ✓<br/>Rule 4: not engineer+prod ✓<br/>Rule 5: risk=low, not high ✓<br/>Result: ALLOW
    R2->>Lambda: invoke costopt-remediation-resize-instance<br/>{resource_id, target_type}
    Lambda->>Lambda: EC2 StopInstance → ModifyInstanceAttribute → StartInstance
    Lambda-->>R2: {success: true, previous_type, new_type}
    R2-->>U: {decision: "ALLOW", execution_result: {...}}
    U->>U: Show "Executed" badge (green)

    Note over U,Approver: FASE 3B: Ejecucion - Accion High Risk (HITL)
    U->>R2: POST /invocations (action_type=delete_ebs_volume,<br/>resource_id=vol-xxx, jwt_token)
    R2->>R2: extract_identity(idToken)<br/>role=manager
    R2->>R2: get_resource_context(vol-xxx)
    R2->>R2: policy.authorize()<br/>Rule 1-4: pass ✓<br/>Rule 5: risk=high → REQUIRES_APPROVAL
    R2->>DDB: put_item({request_id, approval_token,<br/>action_type, resource_id, status=PENDING,<br/>expires_at=now+24h})
    R2->>SNS: publish (Solicitud de Aprobacion)
    SNS->>Approver: Email con links Aprobar/Denegar
    R2-->>U: {decision: "REQUIRES_APPROVAL",<br/>approval_id, reason}
    U->>U: Show "Pending Approval" badge (yellow)

    Note over Approver,Lambda: FASE 4A: Aprobacion - APPROVE
    Approver->>APIGW: Click link "Aprobar"<br/>GET /approve?token=xxx&decision=approve
    APIGW->>LApproval: Invoke approval_handler
    LApproval->>DDB: query(approval_token=xxx)
    LApproval->>DDB: update status=APPROVED
    LApproval->>Lambda: invoke costopt-remediation-delete-ebs-volume<br/>(async, InvocationType=Event)
    Lambda->>Lambda: EC2 DeleteVolume
    LApproval->>DDB: update status=EXECUTED
    LApproval-->>Approver: HTML page "Action APPROVED and execution initiated"

    Note over Approver,Lambda: FASE 4B: Aprobacion - DENY
    Approver->>APIGW: Click link "Denegar"<br/>GET /reject?token=xxx&decision=reject
    APIGW->>LApproval: Invoke approval_handler
    LApproval->>DDB: query(approval_token=xxx)
    LApproval->>DDB: update status=DENIED
    LApproval->>SNS: publish "Request Denied" notification
    LApproval-->>Approver: HTML page "Action DENIED"

    Note over DDB,SNS: FASE 4C: Timeout (24h sin respuesta)
    DDB->>DDB: EventBridge trigger (hourly)
    DDB->>LApproval: Lambda approval_timeout
    LApproval->>DDB: scan(status=PENDING, expires_at < now)
    LApproval->>DDB: update status=EXPIRED
    LApproval->>SNS: publish "Request Expired" notification

    Note over U,Cedar: FASE 3C: Ejecucion - Accion DENEGADA
    U->>R2: POST /invocations (action_type=delete_ebs_volume,<br/>jwt_token with role=engineer)
    R2->>R2: extract_identity(idToken)<br/>role=engineer
    R2->>R2: policy.authorize()<br/>Rule 2: delete_ebs_volume NOT in<br/>engineer allowed actions → DENY
    R2-->>U: {decision: "DENY",<br/>reason: "Role 'engineer' cannot execute<br/>'delete_ebs_volume'. Requires higher privileges."}
    U->>U: Show "Denied" badge (red)
```

## Componentes del Sistema

### Runtimes (AgentCore)

| Runtime | Funcion | Modelo |
|---------|---------|--------|
| `costopt_runtime` | Agente recomendador (chat) | Claude Sonnet 4 |
| `costopt_remediator` | Agente ejecutor (acciones) | Claude Sonnet 4 |
| `costopt_billing_mcp_v1` | MCP Server - Cost Explorer, Compute Optimizer | N/A (tools) |
| `costopt_pricing_mcp_v1` | MCP Server - Pricing API | N/A (tools) |

### Gateways (AgentCore)

| Gateway | Targets | Auth | Policy Engine |
|---------|---------|------|---------------|
| `costopt-gateway` | billingMcp, pricingMcp | Custom JWT (Cognito) | No |
| `costopt-remediator-gw` | resize, stop, terminate, storage, tag, snapshot, volume | Custom JWT (Cognito) | Cedar (costopt_policy_engine) |

### Lambdas de Remediacion

| Lambda | Accion | Riesgo |
|--------|--------|--------|
| `costopt-remediation-resize-instance` | Resize EC2 | Low |
| `costopt-remediation-add-tag` | Add tag | Low |
| `costopt-remediation-modify-storage` | Modify EBS type/size | Low |
| `costopt-remediation-stop-instance` | Stop EC2 | Medium |
| `costopt-remediation-delete-snapshot` | Delete EBS snapshot | Medium |
| `costopt-remediation-terminate-instance` | Terminate EC2 | High |
| `costopt-remediation-delete-ebs-volume` | Delete EBS volume | High |

### Lambdas de Aprobacion

| Lambda | Trigger | Funcion |
|--------|---------|---------|
| `approval_handler` | API Gateway (GET) | Procesa approve/reject desde links en email |
| `approval_timeout` | EventBridge (hourly) | Expira requests PENDING > 24h |

### Clasificacion de Riesgo y Permisos

```mermaid
graph TD
    A[Accion solicitada] --> B{Clasificar riesgo}
    B -->|Low: resize, tag, storage| C{Rol del usuario}
    B -->|Medium: stop, delete_snapshot| C
    B -->|High: terminate, delete_volume| C

    C -->|Analyst| D[DENY - Read only]
    C -->|Engineer + Low/Medium| E{Ambiente?}
    C -->|Engineer + High| D2[DENY - Requires Manager]
    C -->|Manager + Low/Medium| F[ALLOW - Ejecutar]
    C -->|Manager + High| G[REQUIRES_APPROVAL - HITL]

    E -->|Development| F
    E -->|Production| D3[DENY - Requires Manager for prod]

    G --> H[DynamoDB + SNS Email]
    H --> I{Respuesta del approver}
    I -->|Approve| J[Ejecutar Lambda]
    I -->|Reject| K[Notificar denegacion]
    I -->|Timeout 24h| L[Marcar como EXPIRED]
```

### Flujo de Autenticacion

```mermaid
graph LR
    A[Frontend] -->|1. Login| B[Cognito User Pool<br/>costopt-users]
    B -->|2. idToken + credentials| A
    A -->|3. SigV4 + idToken in payload| C[Recommender Runtime]
    C -->|4. JWT Bearer| D[Cost Optimizer Gateway]
    D -->|5. OAuth M2M| E[MCP Runtimes]
    A -->|6. SigV4 + idToken in payload| F[Remediator Runtime]
    F -->|7. Decode idToken → role| G[Policy Engine]
    G -->|8. ALLOW/DENY/REQUIRES_APPROVAL| F
```
