#pragma once

// Classifies an HTTP upload result without depending on Arduino or the
// transport implementation. The queue uses this to avoid hammering an
// endpoint that is rejecting a payload while still retrying network outages.
enum class PostResult {
  kDelivered,
  kRetryableFailure,
  kPermanentFailure,
};

PostResult classifyPostStatus(int status);
const char *postResultName(PostResult result);
