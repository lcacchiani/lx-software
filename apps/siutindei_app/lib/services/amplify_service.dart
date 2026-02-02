import 'package:amplify_api/amplify_api.dart';
import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:amplify_flutter/amplify_flutter.dart';

import '../config/amplify_config.dart';

class AmplifyService {
  bool _configured = false;

  Future<void> configure() async {
    if (_configured) {
      return;
    }
    try {
      Amplify.addPlugins([
        AmplifyAuthCognito(),
        AmplifyAPI(),
      ]);
      await Amplify.configure(AppAmplifyConfig.requireJson());
      _configured = true;
    } on AmplifyAlreadyConfiguredException {
      _configured = true;
    }
  }
}
