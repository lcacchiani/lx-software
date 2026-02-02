class AppAmplifyConfig {
  static const apiName = String.fromEnvironment(
    'AMPLIFY_API_NAME',
    defaultValue: 'activitiesApi',
  );

  static const json = String.fromEnvironment('AMPLIFY_CONFIG');

  static const apiKey = String.fromEnvironment('AMPLIFY_API_KEY');

  static String requireJson() {
    if (json.isEmpty) {
      throw StateError('AMPLIFY_CONFIG is not set');
    }
    return json;
  }
}
