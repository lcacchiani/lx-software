import 'package:firebase_app_check/firebase_app_check.dart';

class DeviceAttestationService {
  Future<String> getToken({bool forceRefresh = false}) async {
    final token = await FirebaseAppCheck.instance.getToken(forceRefresh);
    if (token == null || token.isEmpty) {
      throw StateError('Device attestation token unavailable.');
    }
    return token;
  }
}
