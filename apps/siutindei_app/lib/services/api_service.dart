import 'dart:convert';

import 'package:amplify_flutter/amplify_flutter.dart';

import '../config/amplify_config.dart';
import '../models/activity_models.dart';
import 'auth_service.dart';
import 'device_attestation_service.dart';

class ApiService {
  ApiService(this._authService, this._deviceAttestationService);

  final AuthService _authService;
  final DeviceAttestationService _deviceAttestationService;

  Future<ActivitySearchResponse> searchActivities(ActivitySearchFilters filters) async {
    final tokens = await _authService.tryGetTokens();
    final headers = <String, String>{};
    if (tokens != null) {
      headers['Authorization'] = tokens.idToken;
    }
    if (AppAmplifyConfig.apiKey.isNotEmpty) {
      headers['x-api-key'] = AppAmplifyConfig.apiKey;
    }
    final attestationToken = await _deviceAttestationService.getToken();
    headers['x-device-attestation'] = attestationToken;
    final response = await Amplify.API.get(
      '/v1/activities/search',
      apiName: AppAmplifyConfig.apiName,
      headers: headers,
      queryParameters: filters.toQueryParameters(),
    ).response;
    final decoded = jsonDecode(response.decodeBody()) as Map<String, dynamic>;
    return ActivitySearchResponse.fromJson(decoded);
  }
}
