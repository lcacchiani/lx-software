import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';

import '../config/firebase_config.dart';

class FirebaseInitializer {
  static Future<void> initialize() async {
    final options = FirebaseConfig.optionsForCurrentPlatform();
    if (options != null) {
      await Firebase.initializeApp(options: options);
    } else {
      try {
        await Firebase.initializeApp();
      } catch (_) {
        throw StateError(
          'Firebase is not configured. Provide FIREBASE_* env values or '
          'add Google Services config files.',
        );
      }
    }

    await FirebaseAppCheck.instance.activate(
      providerAndroid: FirebaseConfig.useAppCheckDebug
          ? const AndroidDebugProvider()
          : const AndroidPlayIntegrityProvider(),
      providerApple: FirebaseConfig.useAppCheckDebug
          ? const AppleDebugProvider()
          : const AppleAppAttestWithDeviceCheckFallbackProvider(),
    );
  }
}
