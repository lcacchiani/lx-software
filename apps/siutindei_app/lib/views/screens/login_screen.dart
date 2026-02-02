import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../viewmodels/auth_viewmodel.dart';
import '../widgets/app_text_field.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.errorMessage});

  final String? errorMessage;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authViewModelProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            AppTextField(
              label: 'Email',
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 12),
            if (authState.needsChallenge) ...[
              AppTextField(
                label: 'Email code',
                controller: _codeController,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 12),
            ],
            if (widget.errorMessage != null)
              Text(widget.errorMessage!, style: const TextStyle(color: Colors.red)),
            if (authState.errorMessage != null)
              Text(authState.errorMessage!, style: const TextStyle(color: Colors.red)),
            if (!authState.needsChallenge)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'We will email you a sign-in link and one-time code.',
                  textAlign: TextAlign.center,
                ),
              ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: authState.isLoading
                  ? null
                  : () {
                      if (authState.needsChallenge) {
                        ref.read(authViewModelProvider.notifier).confirmEmailSignIn(
                              code: _codeController.text.trim(),
                            );
                      } else {
                        ref.read(authViewModelProvider.notifier).signInWithEmail(
                              email: _emailController.text.trim(),
                            );
                      }
                    },
              child: authState.isLoading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(authState.needsChallenge ? 'Confirm code' : 'Email me a link'),
            ),
            const SizedBox(height: 24),
            const Text('Or continue with'),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: authState.isLoading
                  ? null
                  : () {
                      ref
                          .read(authViewModelProvider.notifier)
                          .signInWithProvider(AuthProvider.google);
                    },
              child: const Text('Continue with Google'),
            ),
            OutlinedButton(
              onPressed: authState.isLoading
                  ? null
                  : () {
                      ref
                          .read(authViewModelProvider.notifier)
                          .signInWithProvider(AuthProvider.apple);
                    },
              child: const Text('Continue with Apple'),
            ),
            OutlinedButton(
              onPressed: authState.isLoading
                  ? null
                  : () {
                      ref.read(authViewModelProvider.notifier).signInWithProvider(
                            const AuthProvider.custom('Microsoft'),
                          );
                    },
              child: const Text('Continue with Microsoft'),
            ),
          ],
        ),
      ),
    );
  }
}
