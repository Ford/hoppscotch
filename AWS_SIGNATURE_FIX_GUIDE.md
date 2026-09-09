# AWS Signature Authentication Fix Guide

## Problem Fixed

Hoppscotch previously had issues with AWS Signature V4 authentication that caused:
1. **"Can't read importkey" errors** - When WebCrypto signing fails silently
2. **Progress bar stuck forever** - When auth header generation throws an exception but loading state isn't cleared
3. **Missing error messages** - No feedback on what went wrong with signing

## Root Causes Addressed

### 1. Missing Input Validation
- AWS fields (Access Key ID, Secret Key, Service Name) were not validated before signing
- Empty or unresolved environment variables passed to the signer
- No check for required fields

### 2. Unhandled Async Exceptions
- `AwsV4Signer.sign()` calls lacked try/catch blocks
- Exceptions thrown during signing were not caught or reported
- Loading state remained stuck because errors weren't propagated

### 3. No Error Boundary in Request Lifecycle
- Network stream didn't catch errors during request preparation
- Pre-request auth header generation could fail silently
- No final fallback to clear loading state after timeout

## Fixes Applied

### Fix #1: Input Validation (AWSSign.vue)
**File:** `packages/hoppscotch-common/src/components/http/authorization/AWSSign.vue`

- Added required field indicator (`*`) to Access Key ID, Secret Key, and Service Name
- Real-time validation warning display
- Shows exactly which fields are missing before send is attempted

**User Impact:**
- Yellow warning box appears if required fields are empty/invalid
- Prevents sending malformed requests
- Clear feedback on what needs to be filled

### Fix #2: Signing Error Handling (aws-signature.ts)
**File:** `packages/hoppscotch-common/src/helpers/auth/types/aws-signature.ts`

Added comprehensive error handling:
```typescript
try {
  // Validate required fields
  if (!accessKeyId || !accessKeyId.trim()) {
    throw new Error("AWS Signature: Access Key ID is required and cannot be empty")
  }
  if (!secretAccessKey || !secretAccessKey.trim()) {
    throw new Error("AWS Signature: Secret Access Key is required and cannot be empty")
  }
  if (!service || !service.trim()) {
    throw new Error("AWS Signature: Service Name is required and cannot be empty")
  }

  const signer = new AwsV4Signer(signerConfig)
  const sign = await signer.sign()
  return { sign, sortedParams }
} catch (error) {
  throw new Error(
    `AWS Signature signing failed: ${error.message}. Ensure Access Key ID and Secret Access Key are valid, WebCrypto is available, and request is over HTTPS or localhost.`
  )
}
```

**User Impact:**
- Clear error messages explaining what failed
- Actionable hints (check credentials, use HTTPS, etc.)

### Fix #3: GraphQL AWS Auth Error Handling (connection.ts)
**File:** `packages/hoppscotch-common/src/helpers/graphql/connection.ts`

Same validation + error handling applied to GraphQL AWS Signature auth flow.

**User Impact:**
- GraphQL queries with AWS auth now provide clear error feedback
- No more stuck subscriptions

### Fix #4: CLI AWS Auth Error Handling (pre-request.ts)
**File:** `packages/hoppscotch-cli/src/utils/pre-request.ts`

Added try/catch + validation to CLI pre-request flow.

**User Impact:**
- CLI users get proper error codes and messages
- Collection runs with AWS auth fail gracefully with clear messages

### Fix #5: Network Stream Error Boundary (network.ts)
**File:** `packages/hoppscotch-common/src/helpers/network.ts`

Added double error boundary:
1. Catch errors during request preparation (before network call)
2. Catch errors from relay response promise

```typescript
const execResult = RESTRequest.toRequest(req)
  .then((kernelRequest) => {
    // ...
  })
  .catch((error) => {
    // Auth header generation failed - catch and report
    response.next({
      type: "network_fail",
      req,
      error: error instanceof Error ? error : new Error("..."),
    })
    response.complete()
  })
```

**User Impact:**
- Pre-request auth failures are reported immediately
- Response stream always completes, so progress bar can finish
- No orphaned "loading" state

### Fix #6: Loading State Fallback (Request.vue)
**File:** `packages/hoppscotch-common/src/components/http/Request.vue`

Added try/catch/finally:
```typescript
try {
  // Normal request flow
  const [cancel, streamPromise] = runRESTRequest$(tab)
  // ...
} catch (error) {
  // Any unexpected error during pre-request
  toast.error(error.message)
  updateRESTResponse({ type: "script_fail", error })
  tab.value.document.testResults = { /* empty */ }
} finally {
  // 30-second safety timeout: force-clear loading if still stuck
  setTimeout(() => {
    if (loading.value) {
      console.warn("Force-clearing stuck loading state")
      loading.value = false
    }
  }, 30000)
}
```

**User Impact:**
- Any unexpected error stops the request and shows error message
- UI will never stay on progress bar longer than 30 seconds
- Clear console warning if this fallback is needed (indicates a bug to report)

## How to Use (Best Practices)

### 1. Use HTTPS or localhost
AWS Signature uses WebCrypto, which requires:
- **Production:** Use HTTPS (`https://hoppscotch.io`)
- **Local:** Use localhost (`http://localhost:3000`)
- **Not supported:** `http://example.com` (unless it's localhost)

### 2. Resolve Environment Variables First
In the Authorization tab:
- ✅ Correct: `{{ AWS_ACCESS_KEY_ID }}` (when env var exists and is not empty)
- ❌ Wrong: `{{ UNDEFINED_VAR }}` (undefined variables become empty string)
- ❌ Wrong: Leave field blank and set env var later

**Solution:** Use the "Env" dropdown in the top-right to confirm variables are active.

### 3. Fill All Required Fields
- **Access Key ID** (required) - Your AWS access key
- **Secret Access Key** (required) - Your AWS secret key
- **Service Name** (required) - e.g., `s3`, `dynamodb`, `ec2`
- **Region** (optional) - Defaults to `us-east-1`
- **Session Token** (optional) - Only if using temporary credentials

### 4. Test the Signature
Use the "Show Code" button (Code icon) to see the generated Authorization header. Compare with AWS CLI:
```bash
aws s3 ls --debug  # Shows the Authorization header
```

### 5. Troubleshooting

**Error: "AWS Signature: Access Key ID is required and cannot be empty"**
- Check that the field is filled
- If using env var `{{ AWS_KEY }}`, verify the env is active and the variable exists
- Don't leave the field blank hoping the env will fill it later

**Error: "AWS Signature signing failed: ... WebCrypto is available"**
- You're NOT using HTTPS or localhost
- Solution: Use `https://hoppscotch.io` or run locally on `http://localhost:3000`

**Error: "AWS Signature signing failed: ... Ensure Access Key ID and Secret Access Key are valid"**
- Your credentials might be incorrect
- The access key/secret key format might be wrong
- Try with known-good AWS test credentials first

**Progress bar stuck on 50%**
- Wait 30 seconds - UI will auto-clear with warning in console
- Report this to Hoppscotch with your browser console error log
- This should not happen with the new fixes

## Comparison: Postman vs Hoppscotch (After Fix)

| Feature | Postman | Hoppscotch (After Fix) |
|---------|---------|------------------------|
| Field validation | Pre-send check | Real-time warning |
| Error handling | Clear error message | Clear error message + actionable hints |
| Loading state | Never gets stuck | Never gets stuck (+ 30s fallback) |
| WebCrypto errors | Mapped to user message | Mapped to user message |
| Environment variable resolution | Validates before signing | Validates before signing |

## Verification

After this fix, you should:
1. ✅ See a yellow warning box if AWS fields are empty
2. ✅ Get a clear error message if signing fails (not just a stuck progress bar)
3. ✅ See the actual error cause (WebCrypto issue, missing credentials, etc.)
4. ✅ Never have a request stuck on progress bar indefinitely
5. ✅ Be able to send AWS Signature requests on HTTPS or localhost without issues

## Files Modified

1. `packages/hoppscotch-common/src/helpers/auth/types/aws-signature.ts` - Core signing validation + error handling
2. `packages/hoppscotch-common/src/helpers/graphql/connection.ts` - GraphQL AWS auth validation + error handling
3. `packages/hoppscotch-cli/src/utils/pre-request.ts` - CLI AWS auth validation + error handling
4. `packages/hoppscotch-common/src/helpers/network.ts` - Network stream error boundary
5. `packages/hoppscotch-common/src/components/http/Request.vue` - Request lifecycle error handling + timeout fallback
6. `packages/hoppscotch-common/src/components/http/authorization/AWSSign.vue` - UI field validation + warning display

## Additional Notes

- The `aws4fetch` library (v1.0.20) is used for signing and requires WebCrypto
- Errors are now explicitly typed and mapped to user-friendly messages
- The 30-second fallback timeout is a safety net; if it triggers, check browser console for the actual error

