#pragma once

namespace ota_health {

constexpr bool canConfirm(bool validationPending, bool filesystemReady,
                          bool identityReady, bool otaStarted,
                          bool wifiConnected, bool otaInProgress) {
  return validationPending && filesystemReady && identityReady && otaStarted &&
         wifiConnected && !otaInProgress;
}

constexpr bool linkLost(bool wasConnected, bool connected, bool otaStarted,
                        bool otaInProgress) {
  return wasConnected && !connected && otaStarted && !otaInProgress;
}

}  // namespace ota_health
