import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:amplify_flutter/amplify_flutter.dart';

class AuthTokens {
  AuthTokens({required this.idToken, required this.accessToken});

  final String idToken;
  final String accessToken;
}

class AuthService {
  Future<bool> isSignedIn() async {
    final session = await Amplify.Auth.fetchAuthSession();
    return session.isSignedIn;
  }

  Future<AuthTokens> getTokens() async {
    final session = await Amplify.Auth.fetchAuthSession();
    if (session is CognitoAuthSession) {
      final tokensResult = session.userPoolTokensResult;
      final tokens = tokensResult.valueOrNull;
      if (tokens == null) {
        throw tokensResult.exception ??
            const UnknownException('Failed to fetch Cognito tokens.');
      }
      return AuthTokens(
        idToken: tokens.idToken.raw,
        accessToken: tokens.accessToken.raw,
      );
    }
    throw const UnknownException('Auth session is not Cognito.');
  }

  Future<AuthTokens?> tryGetTokens() async {
    try {
      return await getTokens();
    } on AuthException {
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<SignInResult> startPasswordlessSignIn({
    required String username,
  }) {
    return Amplify.Auth.signIn(username: username);
  }

  Future<void> confirmPasswordlessSignIn({required String code}) async {
    final result = await Amplify.Auth.confirmSignIn(confirmationValue: code);
    if (!result.isSignedIn) {
      throw const UnknownException('Sign-in did not complete.');
    }
  }

  Future<void> signUpWithEmail({required String username, required String password}) {
    return Amplify.Auth.signUp(
      username: username,
      password: password,
      options: SignUpOptions(userAttributes: {
        AuthUserAttributeKey.email: username,
      }),
    );
  }

  Future<void> signInWithProvider(AuthProvider provider) async {
    final result = await Amplify.Auth.signInWithWebUI(provider: provider);
    if (!result.isSignedIn) {
      throw const UnknownException('Provider sign-in did not complete.');
    }
  }

  Future<void> signOut() async {
    await Amplify.Auth.signOut();
  }
}
