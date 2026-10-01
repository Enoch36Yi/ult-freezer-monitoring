#include "post_policy.h"

PostResult classifyPostStatus(int status) {
  if (status >= 200 && status < 300) return PostResult::kDelivered;

  // A missing response, timeout, connection reset, gateway failure, or
  // throttling response should be retried. The client uses negative values for
  // transport errors; 0 is included for defensive handling of stub clients.
  if (status <= 0 || status == 408 || status == 425 || status == 429 ||
      status >= 500) {
    return PostResult::kRetryableFailure;
  }

  // 4xx responses other than the explicitly retryable cases indicate a
  // payload, credential, permission, or route problem. Keep the data queued,
  // but do not treat the response as a transient network outage.
  return PostResult::kPermanentFailure;
}

const char *postResultName(PostResult result) {
  switch (result) {
    case PostResult::kDelivered: return "delivered";
    case PostResult::kRetryableFailure: return "retryable_failure";
    case PostResult::kPermanentFailure: return "permanent_failure";
  }
  return "unknown";
}
