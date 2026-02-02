import 'dart:math';

import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:flutter_riverpod/legacy.dart';

import '../services/amplify_service.dart';
import '../services/auth_service.dart';
import '../services/service_providers.dart';

class AuthState {
  const AuthState({
    required this.isLoading,
    required this.isSignedIn,
    required this.needsChallenge,
    this.pendingEmail,
    this.errorMessage,
  });

  final bool isLoading;
  final bool isSignedIn;
  final bool needsChallenge;
  final String? pendingEmail;
  final String? errorMessage;

  factory AuthState.initial() => const AuthState(
        isLoading: true,
        isSignedIn: false,
        needsChallenge: false,
      );

  AuthState copyWith({
    bool? isLoading,
    bool? isSignedIn,
    bool? needsChallenge,
    String? pendingEmail,
    String? errorMessage,
  }) {
    return AuthState(
      isLoading: isLoading ?? this.isLoading,
      isSignedIn: isSignedIn ?? this.isSignedIn,
      needsChallenge: needsChallenge ?? this.needsChallenge,
      pendingEmail: pendingEmail ?? this.pendingEmail,
      errorMessage: errorMessage,
    );
  }
}

class AuthViewModel extends StateNotifier<AuthState> {
  AuthViewModel(this._amplifyService, this._authService)
      : super(AuthState.initial()) {
    _initialize();
  }

  final AmplifyService _amplifyService;
  final AuthService _authService;

  Future<void> _initialize() async {
    try {
      await _amplifyService.configure();
      final signedIn = await _authService.isSignedIn();
      state = state.copyWith(
        isLoading: false,
        isSignedIn: signedIn,
        needsChallenge: false,
        pendingEmail: null,
      );
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }

  Future<void> signInWithEmail({required String email}) async {
    state = state.copyWith(
      isLoading: true,
      errorMessage: null,
      needsChallenge: false,
      pendingEmail: null,
    );
    try {
      final result = await _authService.startPasswordlessSignIn(username: email);
      _handleSignInResult(result, email);
    } on UserNotFoundException {
      try {
        await _authService.signUpWithEmail(
          username: email,
          password: _generatePassword(),
        );
      } on UsernameExistsException {
        // No-op: another client created the user in the meantime.
      }
      final result = await _authService.startPasswordlessSignIn(username: email);
      _handleSignInResult(result, email);
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }

  Future<void> confirmEmailSignIn({required String code}) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      await _authService.confirmPasswordlessSignIn(code: code.trim());
      state = state.copyWith(
        isLoading: false,
        isSignedIn: true,
        needsChallenge: false,
        pendingEmail: null,
      );
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }

  Future<void> signInWithProvider(AuthProvider provider) async {
    state = state.copyWith(
      isLoading: true,
      errorMessage: null,
      needsChallenge: false,
      pendingEmail: null,
    );
    try {
      await _authService.signInWithProvider(provider);
      state = state.copyWith(isLoading: false, isSignedIn: true);
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }

  Future<void> signOut() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      await _authService.signOut();
      state = state.copyWith(
        isLoading: false,
        isSignedIn: false,
        needsChallenge: false,
        pendingEmail: null,
      );
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }

  void _handleSignInResult(SignInResult result, String email) {
    if (result.isSignedIn) {
      state = state.copyWith(isLoading: false, isSignedIn: true);
      return;
    }
    if (result.nextStep.signInStep ==
        AuthSignInStep.confirmSignInWithCustomChallenge) {
      state = state.copyWith(
        isLoading: false,
        needsChallenge: true,
        pendingEmail: email,
      );
      return;
    }
    throw const UnknownException('Unsupported sign-in step.');
  }

  String _generatePassword() {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const symbols = '!@#\$%^&*()_+-=';
    final random = Random.secure();
    final chars = [
      letters[random.nextInt(letters.length)],
      upper[random.nextInt(upper.length)],
      digits[random.nextInt(digits.length)],
      symbols[random.nextInt(symbols.length)],
    ];
    final all = '$letters$upper$digits$symbols';
    for (var i = chars.length; i < 12; i += 1) {
      chars.add(all[random.nextInt(all.length)]);
    }
    chars.shuffle(random);
    return chars.join();
  }
}

/// Provider for the [AuthViewModel].
///
/// Uses [amplifyServiceProvider] and [authServiceProvider] for
/// dependency injection, enabling easier testing through provider overrides.
final authViewModelProvider =
    StateNotifierProvider<AuthViewModel, AuthState>((ref) {
  return AuthViewModel(
    ref.watch(amplifyServiceProvider),
    ref.watch(authServiceProvider),
  );
});
