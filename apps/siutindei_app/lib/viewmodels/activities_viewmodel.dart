import 'package:flutter_riverpod/legacy.dart';

import '../models/activity_models.dart';
import '../services/api_service.dart';
import '../services/service_providers.dart';

class ActivitiesState {
  ActivitiesState({
    required this.isLoading,
    required this.items,
    this.errorMessage,
    this.nextCursor,
  });

  final bool isLoading;
  final List<ActivitySearchResult> items;
  final String? errorMessage;
  final String? nextCursor;

  factory ActivitiesState.initial() =>
      ActivitiesState(isLoading: false, items: const []);

  ActivitiesState copyWith({
    bool? isLoading,
    List<ActivitySearchResult>? items,
    String? errorMessage,
    String? nextCursor,
  }) {
    return ActivitiesState(
      isLoading: isLoading ?? this.isLoading,
      items: items ?? this.items,
      errorMessage: errorMessage,
      nextCursor: nextCursor ?? this.nextCursor,
    );
  }
}

class ActivitiesViewModel extends StateNotifier<ActivitiesState> {
  ActivitiesViewModel(this._apiService) : super(ActivitiesState.initial());

  final ApiService _apiService;

  Future<void> search(ActivitySearchFilters filters) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final response = await _apiService.searchActivities(filters);
      state = state.copyWith(
        isLoading: false,
        items: response.items,
        nextCursor: response.nextCursor,
      );
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }

  Future<void> loadMore(ActivitySearchFilters filters) async {
    if (state.nextCursor == null) {
      return;
    }
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final response = await _apiService.searchActivities(
        ActivitySearchFilters(
          age: filters.age,
          district: filters.district,
          pricingType: filters.pricingType,
          priceMin: filters.priceMin,
          priceMax: filters.priceMax,
          scheduleType: filters.scheduleType,
          dayOfWeekUtc: filters.dayOfWeekUtc,
          dayOfMonth: filters.dayOfMonth,
          startMinutesUtc: filters.startMinutesUtc,
          endMinutesUtc: filters.endMinutesUtc,
          startAtUtc: filters.startAtUtc,
          endAtUtc: filters.endAtUtc,
          languages: filters.languages,
          cursor: state.nextCursor,
          limit: filters.limit,
        ),
      );
      state = state.copyWith(
        isLoading: false,
        items: [...state.items, ...response.items],
        nextCursor: response.nextCursor,
      );
    } catch (error) {
      state = state.copyWith(isLoading: false, errorMessage: error.toString());
    }
  }
}

/// Provider for the [ActivitiesViewModel].
///
/// Uses [apiServiceProvider] for dependency injection, enabling
/// easier testing through provider overrides.
final activitiesViewModelProvider =
    StateNotifierProvider<ActivitiesViewModel, ActivitiesState>((ref) {
  return ActivitiesViewModel(ref.watch(apiServiceProvider));
});
