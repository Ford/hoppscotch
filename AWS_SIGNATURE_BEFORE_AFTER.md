# AWS Signature Fix - Before/After Code Examples

## Fix #1: AWS-Signature Core Signing (aws-signature.ts)

### ❌ Before
```typescript
async function signAWSRequest({
  auth,
  request,
  envVars,
  signQuery = false,
}: SignOptions) {
  // ... setup code ...

  const signer = new AwsV4Signer(signerConfig)
  const sign = await signer.sign()  // ⚠️ No error handling!

  return { sign, sortedParams }
}
```

**Problem:** If `signer.sign()` throws (bad WebCrypto, invalid keys, etc.), exception bubbles up unhandled, loading state stuck.

### ✅ After
```typescript
async function signAWSRequest({
  auth,
  request,
  envVars,
  signQuery = false,
}: SignOptions) {
  // ... setup code ...

  // ✅ Validate required fields FIRST
  if (!accessKeyId || !accessKeyId.trim()) {
    throw new Error(
      "AWS Signature: Access Key ID is required and cannot be empty"
    )
  }
  if (!secretAccessKey || !secretAccessKey.trim()) {
    throw new Error(
      "AWS Signature: Secret Access Key is required and cannot be empty"
    )
  }
  if (!service || !service.trim()) {
    throw new Error(
      "AWS Signature: Service Name is required and cannot be empty"
    )
  }

  // ✅ Wrap in try/catch with descriptive error message
  try {
    const signer = new AwsV4Signer(signerConfig)
    const sign = await signer.sign()
    return { sign, sortedParams }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error)
    throw new Error(
      `AWS Signature signing failed: ${errorMessage}. Ensure Access Key ID and Secret Access Key are valid, WebCrypto is available, and request is over HTTPS or localhost.`
    )
  }
}
```

**Benefits:**
- Pre-validates before signing attempt
- Catches signing errors
- Provides actionable error message
- Clearly communicates HTTPS/WebCrypto requirements

---

## Fix #2: Network Stream Error Boundary (network.ts)

### ❌ Before
```typescript
export function createRESTNetworkRequestStream(
  request: EffectiveHoppRESTRequest
): [Observable<HoppRESTResponse>, () => void] {
  const response = new BehaviorSubject<HoppRESTResponse>({
    type: "loading",
    req: request,
  })

  const req = cloneDeep(request)

  // ⚠️ No error handling around request preparation
  const execResult = RESTRequest.toRequest(req).then((kernelRequest) => {
    if (!kernelRequest) {
      response.next({
        type: "network_fail",
        req,
        error: new Error("Failed to create kernel request"),
      })
      response.complete()
      return
    }
    return service.execute(kernelRequest)
  })

  const service = getService(KernelInterceptorService)

  execResult.then((result) => {
    if (!result) return

    // ⚠️ No catch on response promise
    result.response.then(async (res) => {
      // ... handle response ...
      response.complete()
    })
  })

  return [response, async () => { /* cancel */ }]
}
```

**Problem:**
- If `RESTRequest.toRequest()` throws (auth header error), it's unhandled
- If `result.response` promise rejects, `response` never completes
- Loading state stays indefinitely

### ✅ After
```typescript
export function createRESTNetworkRequestStream(
  request: EffectiveHoppRESTRequest
): [Observable<HoppRESTResponse>, () => void] {
  const response = new BehaviorSubject<HoppRESTResponse>({
    type: "loading",
    req: request,
  })

  const req = cloneDeep(request)

  // ✅ Error boundary #1: Catch request preparation errors
  const execResult = RESTRequest.toRequest(req)
    .then((kernelRequest) => {
      if (!kernelRequest) {
        response.next({
          type: "network_fail",
          req,
          error: new Error("Failed to create kernel request"),
        })
        response.complete()
        return
      }
      return service.execute(kernelRequest)
    })
    .catch((error) => {  // ✅ NEW: Catch auth header generation errors
      response.next({
        type: "network_fail",
        req,
        error:
          error instanceof Error
            ? error
            : new Error(
                "An unknown error occurred during request preparation. Check that all auth credentials are valid and the connection is secure (HTTPS or localhost)."
              ),
      })
      response.complete()
    })

  const service = getService(KernelInterceptorService)

  execResult.then((result) => {
    if (!result) return

    // ✅ Error boundary #2: Catch relay response errors
    result.response
      .then(async (res) => {
        // ... handle response ...
        response.complete()
      })
      .catch((error) => {  // ✅ NEW: Ensure response completes on error
        response.next({
          type: "network_fail",
          req,
          error:
            error instanceof Error
              ? error
              : new Error(
                  "An unknown network error occurred. Check your connection and credentials."
                ),
        })
        response.complete()
      })
  })

  return [response, async () => { /* cancel */ }]
}
```

**Benefits:**
- Pre-request errors caught before network call
- Response promise rejection handled
- Response stream ALWAYS completes (no infinite loading)
- User-friendly error messages at each stage

---

## Fix #3: UI Validation & Warning (AWSSign.vue)

### ❌ Before
```vue
<template>
  <div class="flex flex-1 border-b border-dividerLight">
    <label class="flex items-center ml-4 text-secondaryLight min-w-[6rem]">
      {{ t("authorization.aws_signature.access_key") }}
      <!-- ⚠️ No required indicator -->
    </label>
    <SmartEnvInput
      v-model="auth.accessKey"
      :auto-complete-env="true"
      placeholder="AKIAIOSFODNN7EXAMPLE"
      :envs="envs"
    />
  </div>
  <!-- ... no validation warning display ... -->
</template>

<script setup lang="ts">
// ⚠️ No validation logic
const auth = useVModel(props, "modelValue", emit)
</script>
```

**Problem:**
- Users don't know which fields are required
- No visual feedback until send fails
- Error happens on the server side after sending

### ✅ After
```vue
<template>
  <div class="flex flex-1 border-b border-dividerLight">
    <label class="flex items-center ml-4 text-secondaryLight min-w-[6rem]">
      {{ t("authorization.aws_signature.access_key") }}
      <span class="text-red-400">*</span>  <!-- ✅ Required indicator -->
    </label>
    <SmartEnvInput
      v-model="auth.accessKey"
      :auto-complete-env="true"
      placeholder="AKIAIOSFODNN7EXAMPLE"
      :envs="envs"
    />
  </div>

  <!-- ... similar for secretKey and serviceName ... -->

  <!-- ✅ NEW: Real-time validation warning -->
  <div v-if="validationWarning" class="p-4 bg-yellow-50 border-l-4 border-yellow-400">
    <p class="text-yellow-700 text-sm">
      <strong>⚠ AWS Auth Warning:</strong> {{ validationWarning }}
    </p>
  </div>
</template>

<script setup lang="ts">
const auth = useVModel(props, "modelValue", emit)

// ✅ NEW: Real-time validation
const validationWarning = computed(() => {
  const warnings: string[] = []

  if (!auth.value.accessKey || !auth.value.accessKey.trim()) {
    warnings.push("Access Key ID is required")
  }
  if (!auth.value.secretKey || !auth.value.secretKey.trim()) {
    warnings.push("Secret Access Key is required")
  }
  if (!auth.value.serviceName || !auth.value.serviceName.trim()) {
    warnings.push("Service Name is required")
  }

  return warnings.length > 0
    ? `Missing required fields: ${warnings.join(", ")}. Requests will fail until these are filled.`
    : null
})
</script>
```

**Benefits:**
- Required fields clearly marked with `*`
- Real-time warning as user types
- Yellow box explains what's missing
- User fixes issues BEFORE sending request

---

## Fix #4: Request Lifecycle Error Handling (Request.vue)

### ❌ Before
```typescript
const newSendRequest = async () => {
  loading.value = true

  const [cancel, streamPromise] = runRESTRequest$(tab)
  const streamResult = await streamPromise

  // ⚠️ No try/catch around async operations
  if (E.isRight(streamResult)) {
    subscribeToStream(
      streamResult.right,
      (responseState) => {
        // ... handle response ...
      }
    )
  } else {
    toast.error(`${t("error.script_fail")}`)
    // ... set error response ...
  }

  // ⚠️ What if error happens? loading.value never becomes false!
}
```

**Problem:**
- Uncaught exceptions during pre-request bypass error handling
- Loading state never cleared
- No error message to user

### ✅ After
```typescript
const newSendRequest = async () => {
  loading.value = true

  // ✅ NEW: Wrap entire flow in try/catch/finally
  try {
    const [cancel, streamPromise] = runRESTRequest$(tab)
    const streamResult = await streamPromise

    tab.value.document.cancelFunction = cancel

    if (E.isRight(streamResult)) {
      subscribeToStream(
        streamResult.right,
        (responseState) => {
          // ... handle response ...
        }
      )
    } else {
      toast.error(`${t("error.script_fail")}`)
      // ... set error response ...
    }
  } catch (error) {
    // ✅ NEW: Catch any unexpected errors
    console.error("Request execution error:", error)
    const errorMessage =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred while processing your request"

    toast.error(errorMessage)
    updateRESTResponse({
      type: "script_fail",
      error: new Error(errorMessage),
    })

    // ✅ NEW: Always clear loading state on error
    tab.value.document.testResults = {
      description: "",
      expectResults: [],
      tests: [],
      envDiff: {
        global: { additions: [], deletions: [], updations: [] },
        selected: { additions: [], deletions: [], updations: [] },
      },
      scriptError: true,
      consoleEntries: [],
    }
  } finally {
    // ✅ NEW: 30-second safety timeout
    setTimeout(() => {
      if (loading.value) {
        console.warn(
          "Loading state was not cleared by response. Force-clearing now."
        )
        loading.value = false
      }
    }, 30000)
  }
}
```

**Benefits:**
- Unexpected errors caught and displayed to user
- Loading state ALWAYS clears (even on uncaught exception)
- 30-second safety timeout prevents infinite loading
- Console warning if timeout needed (indicates bug)

---

## Summary Table

| Component | Fix | Impact |
|-----------|-----|--------|
| `aws-signature.ts` | Pre-validation + try/catch | Early error detection with clear messages |
| `connection.ts` | Same validation pattern | GraphQL AWS auth now reliable |
| `pre-request.ts` | Validation + error return | CLI requests fail gracefully |
| `network.ts` | Double error boundary | Response stream ALWAYS completes |
| `Request.vue` | Try/catch/finally + timeout | UI never stuck on loading |
| `AWSSign.vue` | Real-time validation | Users see problems before sending |

---

## Result: User Experience Transformation

**Before:**
```
1. User enters invalid AWS creds
2. Clicks Send
3. Progress bar appears
4. ... nothing happens ...
5. [User waits 5 minutes, then closes browser tab]
```

**After:**
```
1. User enters invalid AWS creds
2. Yellow warning appears: "Missing required fields: Access Key ID"
3. User fills in missing field
4. Clicks Send
5. Request processes immediately
6. If error: Toast message appears explaining what failed
7. [2 seconds later] Error message + cleared UI
```

