# Security Policy

## Reporting a Vulnerability

We take the security of AgentCore Cost Optimizer seriously. If you discover a security vulnerability in this project, please report it responsibly.

### How to Report

**Do not create a public GitHub issue for security vulnerabilities.**

Instead, please report security issues through one of the following methods:

1. **AWS Security Vulnerability Reporting**: Visit [aws.amazon.com/security/vulnerability-reporting](http://aws.amazon.com/security/vulnerability-reporting/)
2. **Email**: Contact opensource-codeofconduct@amazon.com with details of the vulnerability

### What to Include

When reporting a security vulnerability, please include:

- **Description**: A clear description of the vulnerability
- **Impact**: The potential impact if exploited
- **Reproduction Steps**: Step-by-step instructions to reproduce the issue
- **Affected Components**: Which parts of the system are affected (e.g., agent runtime, policy engine, frontend)
- **Suggested Fix**: If you have ideas on how to address the vulnerability
- **Your Contact Information**: How we can reach you for follow-up questions

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 3 business days
- **Communication**: We will keep you informed of our progress in addressing the vulnerability
- **Credit**: With your permission, we will credit you for the discovery in our security advisories
- **Disclosure**: We follow responsible disclosure practices and will coordinate with you on public disclosure timing

## Security Best Practices

When deploying and using AgentCore Cost Optimizer:

### Authentication & Authorization

- **Enable MFA**: Always enable multi-factor authentication for Cognito users
- **Rotate Credentials**: Regularly rotate AWS IAM credentials and Cognito user passwords
- **Least Privilege**: Follow the principle of least privilege for IAM roles and Cedar policies
- **Review Policies**: Regularly review and audit Cedar policies for remediation actions

### Network Security

- **VPC Deployment**: Consider deploying Lambda functions within a VPC for network isolation
- **Private Endpoints**: Use VPC endpoints for AWS services (S3, DynamoDB, etc.) to avoid internet egress
- **API Authentication**: All API Gateway endpoints require JWT authentication via Cognito
- **HTTPS Only**: CloudFront distribution enforces HTTPS-only communication

### Data Protection

- **Encryption at Rest**: DynamoDB tables use AWS-managed encryption keys by default
- **Encryption in Transit**: All communication uses TLS 1.2 or higher
- **Sensitive Data**: Never log AWS credentials, tokens, or sensitive customer data
- **Conversation History**: Conversation memory may contain sensitive cost data—review DynamoDB access policies

### Operational Security

- **Git-Secrets**: Run git-secrets before committing code to prevent credential leaks
- **Dependency Scanning**: Regularly update dependencies and scan for known vulnerabilities
- **CloudWatch Logs**: Enable CloudWatch Logs for all Lambda functions for audit trails
- **Monitoring**: Set up CloudWatch alarms for unusual API activity or remediation patterns

### Remediation Actions

- **Approval Workflows**: High-risk remediation actions require human-in-the-loop approval
- **Risk Classification**: Review risk levels (LOW/MEDIUM/HIGH) before granting permissions
- **Production Guards**: Cedar policies prevent production resource termination without approval
- **Rollback Plans**: Always have a rollback plan before executing remediation actions

## Known Security Considerations

### Current Implementation

1. **Cedar Policy Evaluation**: Application-level policy engine in Remediator Gateway—not AWS-native authorization
2. **JWT Tokens**: Short-lived tokens (default 1 hour) issued by Cognito Identity Pool
3. **MCP Gateway Authentication**: JWT validation on every MCP tool call
4. **Conversation Memory**: Stored in DynamoDB—ensure access is restricted to authorized users only
5. **Frontend Assets**: Hosted on CloudFront—review CloudFront access logs for security monitoring

### Future Enhancements

- Integration with AWS IAM Identity Center for federated authentication
- AWS PrivateLink support for fully private deployments
- Encryption of conversation history with customer-managed KMS keys
- Integration with AWS Security Hub for centralized security findings

## Security Features

This project implements several security controls:

- ✅ **Authentication**: Amazon Cognito with MFA support
- ✅ **Authorization**: Cedar policies for fine-grained access control
- ✅ **Risk Classification**: Automatic risk assessment (LOW/MEDIUM/HIGH) for all actions
- ✅ **HITL Approval**: Human-in-the-loop workflow for high-risk operations
- ✅ **Audit Logging**: CloudWatch Logs for all agent interactions and remediation actions
- ✅ **Encryption**: TLS in transit, DynamoDB encryption at rest
- ✅ **Input Validation**: JSON schema validation for all MCP tool inputs
- ✅ **Error Handling**: Safe error messages that don't leak internal implementation details

## Compliance

This sample code is provided for demonstration purposes and should be reviewed against your organization's security and compliance requirements before use in production environments.

### Considerations for Production Use

- **Data Residency**: Ensure deployed regions comply with data residency requirements
- **Logging & Auditing**: Enable AWS CloudTrail for all AWS API calls
- **Backup & Recovery**: Implement backup strategies for DynamoDB conversation history
- **Incident Response**: Establish incident response procedures for security events
- **Security Reviews**: Conduct regular security reviews and penetration testing

## Dependencies

This project uses third-party dependencies. See [NOTICE](NOTICE) for attribution and [pyproject.toml](pyproject.toml) for the complete dependency list.

### Keeping Dependencies Secure

```bash
# Check for known vulnerabilities in Python dependencies
pip-audit

# Update all dependencies to latest secure versions
pip install --upgrade -e ".[dev]"

# Check for outdated npm packages (CDK)
cd cdk && npm outdated && cd ..

# Check for outdated npm packages (Frontend)
cd frontend && npm outdated && cd ..
```

## Additional Resources

- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [Amazon Bedrock Security](https://docs.aws.amazon.com/bedrock/latest/userguide/security.html)
- [Cedar Policy Language](https://www.cedarpolicy.com/)
- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)

## Contact

For general questions about this project, please open a GitHub issue. For security vulnerabilities, please follow the [reporting process](#how-to-report) above.
