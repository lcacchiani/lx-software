import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/activity_models.dart';
import '../../viewmodels/activities_viewmodel.dart';
import '../../viewmodels/auth_viewmodel.dart';
import '../widgets/app_text_field.dart';
import 'login_screen.dart';

class ActivitiesScreen extends ConsumerStatefulWidget {
  const ActivitiesScreen({super.key});

  @override
  ConsumerState<ActivitiesScreen> createState() => _ActivitiesScreenState();
}

class _ActivitiesScreenState extends ConsumerState<ActivitiesScreen> {
  final _ageController = TextEditingController();
  final _districtController = TextEditingController();
  final _languageController = TextEditingController();
  final _priceMinController = TextEditingController();
  final _priceMaxController = TextEditingController();
  final _dayOfWeekController = TextEditingController();
  final _startMinutesController = TextEditingController();
  final _endMinutesController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(activitiesViewModelProvider.notifier).search(_buildFilters());
    });
  }

  @override
  void dispose() {
    _ageController.dispose();
    _districtController.dispose();
    _languageController.dispose();
    _priceMinController.dispose();
    _priceMaxController.dispose();
    _dayOfWeekController.dispose();
    _startMinutesController.dispose();
    _endMinutesController.dispose();
    super.dispose();
  }

  ActivitySearchFilters _buildFilters({String? cursor}) {
    return ActivitySearchFilters(
      age: int.tryParse(_ageController.text),
      district: _districtController.text.trim().isEmpty
          ? null
          : _districtController.text.trim(),
      priceMin: double.tryParse(_priceMinController.text),
      priceMax: double.tryParse(_priceMaxController.text),
      dayOfWeekUtc: int.tryParse(_dayOfWeekController.text),
      startMinutesUtc: int.tryParse(_startMinutesController.text),
      endMinutesUtc: int.tryParse(_endMinutesController.text),
      languages: _languageController.text.trim().isEmpty
          ? const []
          : _languageController.text.split(',').map((e) => e.trim()).toList(),
      cursor: cursor,
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(activitiesViewModelProvider);
    final authState = ref.watch(authViewModelProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Activities'),
        actions: [
          if (authState.isSignedIn)
            IconButton(
              onPressed: () => ref.read(authViewModelProvider.notifier).signOut(),
              icon: const Icon(Icons.logout),
            )
          else
            IconButton(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                );
              },
              icon: const Icon(Icons.login),
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            flex: 0,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  AppTextField(
                    label: 'Age',
                    controller: _ageController,
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 8),
                  AppTextField(
                    label: 'District',
                    controller: _districtController,
                  ),
                  const SizedBox(height: 8),
                  AppTextField(
                    label: 'Languages (comma-separated)',
                    controller: _languageController,
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: AppTextField(
                          label: 'Price min',
                          controller: _priceMinController,
                          keyboardType: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppTextField(
                          label: 'Price max',
                          controller: _priceMaxController,
                          keyboardType: TextInputType.number,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: AppTextField(
                          label: 'Day of week (0-6)',
                          controller: _dayOfWeekController,
                          keyboardType: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppTextField(
                          label: 'Start minutes UTC',
                          controller: _startMinutesController,
                          keyboardType: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AppTextField(
                          label: 'End minutes UTC',
                          controller: _endMinutesController,
                          keyboardType: TextInputType.number,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    onPressed: state.isLoading
                        ? null
                        : () {
                            ref
                                .read(activitiesViewModelProvider.notifier)
                                .search(_buildFilters());
                          },
                    child: const Text('Search'),
                  ),
                  if (state.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        state.errorMessage!,
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: state.isLoading && state.items.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    itemCount: state.items.length + (state.nextCursor != null ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index >= state.items.length) {
                        return Padding(
                          padding: const EdgeInsets.all(16),
                          child: ElevatedButton(
                            onPressed: state.isLoading
                                ? null
                                : () {
                                    ref
                                        .read(activitiesViewModelProvider.notifier)
                                        .loadMore(
                                          _buildFilters(cursor: state.nextCursor),
                                        );
                                  },
                            child: const Text('Load more'),
                          ),
                        );
                      }
                      final item = state.items[index];
                      return ListTile(
                        title: Text(item.activity.name),
                        subtitle: Text(
                          '${item.organization.name} • ${item.location.district}',
                        ),
                        trailing: Text(
                          '${item.pricing.currency} ${item.pricing.amount.toStringAsFixed(0)}',
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
