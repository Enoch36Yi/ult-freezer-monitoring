#pragma once

#include <stddef.h>

// Cache whether a queue file is expected. LittleFS.exists() reports an error
// for a missing file on this board, so the hot loop must not probe it.
class QueuePresence {
 public:
  void onMount(bool exists) { hasData_ = exists; }
  void onBuffered() { hasData_ = true; }
  void onFlushRemaining(size_t count) { hasData_ = count > 0; }
  bool hasData() const { return hasData_; }

 private:
  bool hasData_ = false;
};
