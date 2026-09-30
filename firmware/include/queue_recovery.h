#pragma once

#include <stddef.h>
#include <stdint.h>

enum class QueueTempAction : uint8_t {
  kNone,
  kDiscardTemp,
  kAdoptTemp,
};

// A temp file is safe to adopt only when the original queue is absent. When
// both exist, the original is the last known complete copy and must win.
constexpr QueueTempAction queueTempAction(bool hasQueue, bool hasTemp) {
  if (!hasTemp) return QueueTempAction::kNone;
  return hasQueue ? QueueTempAction::kDiscardTemp : QueueTempAction::kAdoptTemp;
}

constexpr bool queueFinalByteCompletesLine(int lastByte) {
  return lastByte == '\n';
}

// Returns the byte length that can be retained without an incomplete final
// record. JSON validation happens at ingest; this only protects line framing.
inline size_t completeQueueBytes(const char *data, size_t length) {
  if (length == 0 || data[length - 1] == '\n') return length;
  for (size_t i = length; i > 0; --i) {
    if (data[i - 1] == '\n') return i;
  }
  return 0;
}
