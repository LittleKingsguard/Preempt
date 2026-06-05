# Preempt MCP Route (`/validate-and-save`)

This skill describes how to interact with the backend MCP validation and save route in the Preempt project (`server/src/routes/mcp.ts`), which is responsible for safely validating UI component changes against the `Supervisor` pipeline and staging them to the database for admin approval.

## Overview

The `/validate-and-save` endpoint is used to submit modifications to Templates, Contents, Components, and Handlers. 

- **Endpoint**: `POST /api/mcp/validate-and-save` (often prefixed appropriately).
- **Authentication**: Requires valid authentication (`mcpAuth`).
- **Body requirements**:
  - `templateData`: Full template hierarchy data
  - `contentData`: Full content hierarchy payload
  - `description`: String description for the change batch
  - `targets`: Array of changes being made. Example structure:
    ```json
    [
      {
        "type": "component", 
        "name": "MyComponentName", 
        "id": 12, 
        "payload": { ... },
        "query": { "className": "my-class" }
      }
    ]
    ```

## Security Restrictions: Handler Processing is Blocked

**CRITICAL**: During the validation phase on the server, `isValidationRun: true` is passed to the `PipelineConfig`. This completely **skips all handler checks** (pre-assembly, post-assembly, etc.). 

Why? To prevent unapproved, malicious code from executing on the server.

**Consequences for Testing & Submissions**:
Since handler logic does NOT run on the server during validation, any handler logic that dynamically changes the data structure or node assembly will **not** be evaluated. 

Therefore, when submitting changes that rely on handlers to structure the data, you MUST provide the payload containing the **valid surrounding code / structure** as if the handler had already executed correctly. The `Supervisor` will strictly validate the static shape of the data provided.

## Staging & Return Data

1. **Validation**: It instantiates the Supervisor with `templateData` and `contentData`, verifying assembly and schemas.
2. **Extraction**: Uses `target.query` to locate the exact node within the assembled Supervisor stack to extract validated payloads.
3. **Staging**: Calls `stageComponent`, `stageHandler`, `stageTemplate`, or `stageContent`. The functions create a `ChangeBatch` and correctly handle historical/approved overwrites using a `JOIN ChangeBatches` query where `merged_at IS NULL`.
4. **Return values**:
   The API responds with:
   ```json
   {
     "success": true,
     "batchId": 123,
     "savedTargets": [
       {
         "type": "target_type",
         "name": "target_name",
         "id": 12,
         "savedData": { /* Staged row data returned from DB */ }
       }
     ]
   }
   ```
   *The `savedTargets` array returns the exact rows that were staged, allowing the caller to know exactly what to overwrite in case of subsequent changes before final approval.*
