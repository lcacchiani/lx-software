/// Service providers for dependency injection.
///
/// This module provides Riverpod providers for all services, enabling
/// proper dependency injection and easier testing through provider overrides.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'amplify_service.dart';
import 'api_service.dart';
import 'auth_service.dart';
import 'device_attestation_service.dart';

/// Provider for the [AuthService].
///
/// Override in tests:
/// ```dart
/// final container = ProviderContainer(
///   overrides: [
///     authServiceProvider.overrideWithValue(MockAuthService()),
///   ],
/// );
/// ```
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService();
});

/// Provider for the [DeviceAttestationService].
final deviceAttestationServiceProvider = Provider<DeviceAttestationService>(
  (ref) => DeviceAttestationService(),
);

/// Provider for the [AmplifyService].
final amplifyServiceProvider = Provider<AmplifyService>(
  (ref) => AmplifyService(),
);

/// Provider for the [ApiService].
///
/// Depends on [authServiceProvider] and [deviceAttestationServiceProvider].
final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService(
    ref.watch(authServiceProvider),
    ref.watch(deviceAttestationServiceProvider),
  );
});
