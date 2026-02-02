# Code Review: Improvement Suggestions

This document provides a comprehensive review of the codebase with actionable improvement suggestions based on best practices and reusability.

## Executive Summary

The solution demonstrates solid architecture with proper separation of concerns, well-designed database schema, and comprehensive infrastructure-as-code. The areas with the most potential for improvement are:

1. **Code Duplication** - Several utility functions are duplicated across modules
2. **Error Handling** - More structured error handling needed
3. **Testing** - Test coverage could be expanded significantly
4. **Flutter State Management** - Service injection pattern needs improvement
5. **Type Safety** - Some areas could benefit from stricter typing

---

## 1. Backend Python Code

### 1.1 Duplicate Code in Lambda Handlers

**Issue**: The `activities_search.py` and `admin.py` modules have duplicated utility functions.

**Current Duplication**:
- `_parse_int()`, `_parse_datetime()`, `_json_response()` exist in both files
- Cursor encoding/decoding logic is duplicated
- Database engine creation is duplicated

**Recommendation**: Extract shared utilities to a common module.

```python
# backend/src/app/utils/parsers.py
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional, TypeVar
from enum import Enum

T = TypeVar('T', bound=Enum)


def parse_int(value: Optional[str]) -> Optional[int]:
    """Parse an integer from a string."""
    if value is None or value == '':
        return None
    return int(value)


def parse_decimal(value: Optional[str]) -> Optional[Decimal]:
    """Parse a decimal from a string."""
    if value is None or value == '':
        return None
    return Decimal(value)


def parse_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 datetime string."""
    if value is None or value == '':
        return None
    cleaned = value.replace('Z', '+00:00') if value.endswith('Z') else value
    return datetime.fromisoformat(cleaned)


def parse_enum(value: Optional[str], enum_type: type[T]) -> Optional[T]:
    """Parse an enum value from a string."""
    if value is None or value == '':
        return None
    return enum_type(value)
```

```python
# backend/src/app/utils/responses.py
from __future__ import annotations

import json
from typing import Any


def json_response(status_code: int, body: Any) -> dict[str, Any]:
    """Create a JSON API Gateway response."""
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(body, default=str),
    }
```

### 1.2 Database Engine Management

**Issue**: Engine creation is duplicated and inconsistent between modules.

**Recommendation**: Create a centralized engine factory.

```python
# backend/src/app/db/engine.py
from __future__ import annotations

import os
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from app.db.connection import get_database_url

_ENGINE_CACHE: dict[str, Engine] = {}


def get_engine(use_cache: bool = True, pool_class: type | None = None) -> Engine:
    """Get or create a SQLAlchemy engine with appropriate settings for Lambda."""
    use_iam_auth = str(os.getenv('DATABASE_IAM_AUTH', '')).lower() in {'1', 'true', 'yes'}
    
    # IAM auth tokens expire, so don't cache the engine
    if use_iam_auth:
        use_cache = False
        pool_class = NullPool
    
    cache_key = 'default'
    if use_cache and cache_key in _ENGINE_CACHE:
        return _ENGINE_CACHE[cache_key]
    
    database_url = get_database_url()
    pool_settings = _get_pool_settings(use_iam_auth, pool_class)
    
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={'sslmode': os.getenv('DATABASE_SSLMODE', 'require')},
        **pool_settings,
    )
    
    if use_cache:
        _ENGINE_CACHE[cache_key] = engine
    
    return engine


def _get_pool_settings(use_iam_auth: bool, pool_class: type | None) -> dict[str, Any]:
    """Return connection pool settings tuned for Lambda."""
    if use_iam_auth or pool_class == NullPool:
        return {'poolclass': NullPool}
    
    return {
        'pool_size': int(os.getenv('DB_POOL_SIZE', '1')),
        'max_overflow': int(os.getenv('DB_MAX_OVERFLOW', '0')),
        'pool_recycle': int(os.getenv('DB_POOL_RECYCLE', '300')),
        'pool_timeout': int(os.getenv('DB_POOL_TIMEOUT', '30')),
    }
```

### 1.3 Custom Error Types

**Issue**: The code uses generic `ValueError` and `RuntimeError` for all errors, making it hard to handle specific error cases.

**Recommendation**: Create domain-specific exception classes.

```python
# backend/src/app/exceptions.py
from __future__ import annotations


class AppError(Exception):
    """Base exception for application errors."""
    
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class ValidationError(AppError):
    """Raised when input validation fails."""
    
    def __init__(self, message: str):
        super().__init__(message, status_code=400)


class NotFoundError(AppError):
    """Raised when a resource is not found."""
    
    def __init__(self, resource: str, identifier: str):
        super().__init__(f'{resource} not found: {identifier}', status_code=404)


class AuthorizationError(AppError):
    """Raised when authorization fails."""
    
    def __init__(self, message: str = 'Forbidden'):
        super().__init__(message, status_code=403)


class ConfigurationError(AppError):
    """Raised when required configuration is missing."""
    
    def __init__(self, config_name: str):
        super().__init__(f'{config_name} is required', status_code=500)
```

### 1.4 Pydantic Schema Improvements

**Issue**: The schemas in `schemas.py` could be more robust with field validators and better documentation.

**Recommendation**: Add field validators and examples.

```python
# backend/src/app/api/schemas.py
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LocationSchema(BaseModel):
    """Location schema with coordinate validation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    district: str
    address: Optional[str] = None
    lat: Optional[Decimal] = Field(None, ge=-90, le=90, description='Latitude')
    lng: Optional[Decimal] = Field(None, ge=-180, le=180, description='Longitude')

    @field_validator('lat', 'lng', mode='before')
    @classmethod
    def round_coordinates(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            return round(v, 6)
        return v


class PricingSchema(BaseModel):
    """Pricing schema with amount validation."""

    model_config = ConfigDict(from_attributes=True)

    pricing_type: str
    amount: Decimal = Field(..., ge=0, description='Price amount')
    currency: str = Field(..., min_length=3, max_length=3)
    sessions_count: Optional[int] = Field(None, ge=1)

    @field_validator('currency')
    @classmethod
    def uppercase_currency(cls, v: str) -> str:
        return v.upper()
```

### 1.5 Repository Pattern for Database Operations

**Issue**: Database queries are embedded directly in handlers, making testing and reuse difficult.

**Recommendation**: Implement repository pattern for database operations.

```python
# backend/src/app/db/repositories/base.py
from __future__ import annotations

from typing import Generic, Optional, Sequence, Type, TypeVar
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import Base

T = TypeVar('T', bound=Base)


class BaseRepository(Generic[T]):
    """Base repository with common CRUD operations."""

    def __init__(self, session: Session, model: Type[T]):
        self._session = session
        self._model = model

    def get_by_id(self, entity_id: UUID) -> Optional[T]:
        """Get entity by ID."""
        return self._session.get(self._model, entity_id)

    def get_all(self, limit: int = 50, cursor: Optional[UUID] = None) -> Sequence[T]:
        """Get all entities with cursor pagination."""
        query = select(self._model).order_by(self._model.id)
        if cursor is not None:
            query = query.where(self._model.id > cursor)
        return self._session.execute(query.limit(limit)).scalars().all()

    def create(self, entity: T) -> T:
        """Create a new entity."""
        self._session.add(entity)
        self._session.flush()
        return entity

    def update(self, entity: T) -> T:
        """Update an existing entity."""
        self._session.add(entity)
        self._session.flush()
        return entity

    def delete(self, entity: T) -> None:
        """Delete an entity."""
        self._session.delete(entity)
        self._session.flush()
```

---

## 2. Flutter Mobile App

### 2.1 Service Injection Pattern

**Issue**: Services are instantiated directly in viewmodel providers, making testing difficult and creating tight coupling.

**Current Code** (`activities_viewmodel.dart`):
```dart
final activitiesViewModelProvider =
    StateNotifierProvider<ActivitiesViewModel, ActivitiesState>((ref) {
  final authService = AuthService();
  final deviceAttestationService = DeviceAttestationService();
  final apiService = ApiService(authService, deviceAttestationService);
  return ActivitiesViewModel(apiService);
});
```

**Recommendation**: Use proper dependency injection with service providers.

```dart
// lib/services/service_providers.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'amplify_service.dart';
import 'api_service.dart';
import 'auth_service.dart';
import 'device_attestation_service.dart';

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

final deviceAttestationServiceProvider = Provider<DeviceAttestationService>(
  (ref) => DeviceAttestationService(),
);

final amplifyServiceProvider = Provider<AmplifyService>(
  (ref) => AmplifyService(),
);

final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService(
    ref.watch(authServiceProvider),
    ref.watch(deviceAttestationServiceProvider),
  );
});
```

```dart
// lib/viewmodels/activities_viewmodel.dart
final activitiesViewModelProvider =
    StateNotifierProvider<ActivitiesViewModel, ActivitiesState>((ref) {
  return ActivitiesViewModel(ref.watch(apiServiceProvider));
});
```

### 2.2 Freezed for Immutable State Classes

**Issue**: State classes use manual `copyWith` implementations which are error-prone and verbose.

**Recommendation**: Use the `freezed` package for immutable data classes.

```dart
// lib/viewmodels/activities_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';

import '../models/activity_models.dart';

part 'activities_state.freezed.dart';

@freezed
class ActivitiesState with _$ActivitiesState {
  const factory ActivitiesState({
    @Default(false) bool isLoading,
    @Default([]) List<ActivitySearchResult> items,
    String? errorMessage,
    String? nextCursor,
  }) = _ActivitiesState;
}
```

### 2.3 Result Type for API Operations

**Issue**: API operations return values directly or throw exceptions, making error handling inconsistent.

**Recommendation**: Use a Result type for API operations.

```dart
// lib/utils/result.dart
sealed class Result<T> {
  const Result();
}

final class Success<T> extends Result<T> {
  const Success(this.value);
  final T value;
}

final class Failure<T> extends Result<T> {
  const Failure(this.error, [this.stackTrace]);
  final Object error;
  final StackTrace? stackTrace;
}

extension ResultExtension<T> on Result<T> {
  T? get valueOrNull => switch (this) {
    Success(:final value) => value,
    Failure() => null,
  };
  
  R when<R>({
    required R Function(T value) success,
    required R Function(Object error, StackTrace? stackTrace) failure,
  }) => switch (this) {
    Success(:final value) => success(value),
    Failure(:final error, :final stackTrace) => failure(error, stackTrace),
  };
}
```

```dart
// lib/services/api_service.dart
Future<Result<ActivitySearchResponse>> searchActivities(
  ActivitySearchFilters filters,
) async {
  try {
    final tokens = await _authService.tryGetTokens();
    final headers = <String, String>{};
    // ... existing header setup ...
    
    final response = await Amplify.API.get(
      '/v1/activities/search',
      apiName: AppAmplifyConfig.apiName,
      headers: headers,
      queryParameters: filters.toQueryParameters(),
    ).response;
    
    final decoded = jsonDecode(response.decodeBody()) as Map<String, dynamic>;
    return Success(ActivitySearchResponse.fromJson(decoded));
  } catch (e, st) {
    return Failure(e, st);
  }
}
```

### 2.4 Model Classes with JSON Serialization

**Issue**: Manual JSON parsing is verbose and error-prone.

**Recommendation**: Use `json_serializable` package.

```dart
// lib/models/activity_models.dart
import 'package:json_annotation/json_annotation.dart';

part 'activity_models.g.dart';

@JsonSerializable(fieldRename: FieldRename.snake)
class Activity {
  Activity({
    required this.id,
    required this.name,
    this.description,
    this.ageMin,
    this.ageMax,
  });

  final String id;
  final String name;
  final String? description;
  final int? ageMin;
  final int? ageMax;

  factory Activity.fromJson(Map<String, dynamic> json) => _$ActivityFromJson(json);
  Map<String, dynamic> toJson() => _$ActivityToJson(this);
}
```

### 2.5 Separate Filter Widget from Screen

**Issue**: The `ActivitiesScreen` has filter UI tightly coupled with results display.

**Recommendation**: Extract filter form to a reusable widget.

```dart
// lib/views/widgets/activity_filters_form.dart
class ActivityFiltersForm extends StatelessWidget {
  const ActivityFiltersForm({
    super.key,
    required this.onSubmit,
    this.isLoading = false,
  });

  final void Function(ActivitySearchFilters filters) onSubmit;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    // Move filter fields here
  }
}
```

---

## 3. Infrastructure (CDK)

### 3.1 Split Monolithic Stack

**Issue**: `api-stack.ts` is over 900 lines and contains all infrastructure.

**Recommendation**: Split into multiple smaller stacks/constructs.

```typescript
// lib/constructs/database-construct.ts
export class DatabaseConstruct extends Construct {
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly secret: secretsmanager.ISecret;
  
  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);
    // Database setup logic
  }
}

// lib/constructs/auth-construct.ts
export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.CfnUserPoolClient;
  
  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);
    // Auth setup logic
  }
}

// lib/constructs/api-construct.ts
export class ApiConstruct extends Construct {
  public readonly api: apigateway.RestApi;
  
  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);
    // API Gateway setup logic
  }
}
```

### 3.2 Configuration Management

**Issue**: Many CFN parameters are defined inline. Configuration could be better organized.

**Recommendation**: Use a typed configuration interface.

```typescript
// lib/config/stack-config.ts
export interface StackConfig {
  readonly resourcePrefix: string;
  readonly cognito: CognitoConfig;
  readonly database: DatabaseConfig;
  readonly api: ApiConfig;
}

export interface CognitoConfig {
  readonly domainPrefix: string;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
  readonly providers: IdentityProviderConfig;
}

export interface DatabaseConfig {
  readonly minCapacity: number;
  readonly maxCapacity: number;
  readonly databaseName: string;
}

// Load from params file or environment
export function loadConfig(environment: string): StackConfig {
  const configPath = path.join(__dirname, `../params/${environment}.json`);
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
```

### 3.3 Lambda Function Factory Improvements

**Issue**: The `createPythonFunction` helper could be more reusable and type-safe.

**Recommendation**: Create a typed Lambda factory construct.

```typescript
// lib/constructs/python-lambda.ts
export interface PythonLambdaProps {
  functionName: string;
  handler: string;
  description?: string;
  environment?: Record<string, string>;
  timeout?: cdk.Duration;
  memorySize?: number;
  vpc?: ec2.IVpc;
  securityGroups?: ec2.ISecurityGroup[];
  layers?: lambda.ILayerVersion[];
}

export class PythonLambda extends Construct {
  public readonly function: lambda.Function;
  
  constructor(scope: Construct, id: string, props: PythonLambdaProps) {
    super(scope, id);
    
    this.function = new lambda.Function(this, 'Function', {
      functionName: props.functionName,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: props.handler,
      description: props.description,
      memorySize: props.memorySize ?? 512,
      timeout: props.timeout ?? cdk.Duration.seconds(30),
      code: this.getBundledCode(),
      environment: {
        PYTHONPATH: '/var/task/src',
        ...props.environment,
      },
      vpc: props.vpc,
      securityGroups: props.securityGroups,
      vpcSubnets: props.vpc ? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } : undefined,
      layers: props.layers,
    });
    
    this.addLogRetention();
  }
  
  private getBundledCode(): lambda.Code {
    return lambda.Code.fromAsset(path.join(__dirname, '../../..'), {
      bundling: {
        image: lambda.Runtime.PYTHON_3_12.bundlingImage,
        command: ['bash', '-c', this.getBundlingCommands().join(' && ')],
      },
    });
  }
  
  private getBundlingCommands(): string[] {
    return [
      'pip install -r requirements.txt -t /asset-output',
      'cp -au lambda /asset-output/lambda',
      'cp -au src /asset-output/src',
    ];
  }
  
  private addLogRetention(): void {
    new logs.LogRetention(this, 'LogRetention', {
      logGroupName: `/aws/lambda/${this.function.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });
  }
}
```

---

## 4. Testing

### 4.1 Test Structure and Coverage

**Issue**: Limited test coverage. Tests only cover query validation and admin auth.

**Recommendation**: Add comprehensive tests for:

1. **Unit tests for all utility functions**
2. **Integration tests for Lambda handlers**
3. **Database tests with fixtures**
4. **Flutter widget tests**

```python
# tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base


@pytest.fixture(scope='session')
def test_engine():
    """Create a test database engine."""
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def db_session(test_engine):
    """Create a test database session."""
    Session = sessionmaker(bind=test_engine)
    session = Session()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def sample_organization(db_session):
    """Create a sample organization for testing."""
    from app.db.models import Organization
    org = Organization(name='Test Org', description='Test Description')
    db_session.add(org)
    db_session.flush()
    return org
```

```python
# tests/test_api_handlers.py
import json
from unittest.mock import MagicMock, patch

import pytest


class TestActivitySearchHandler:
    """Tests for the activity search Lambda handler."""

    def test_returns_400_for_invalid_filters(self):
        """Invalid filter combinations should return 400."""
        from lambda.activity_search.handler import lambda_handler
        
        event = {
            'queryStringParameters': {
                'day_of_week_utc': '2',
                'day_of_month': '15',  # Invalid combination
            }
        }
        
        response = lambda_handler(event, None)
        
        assert response['statusCode'] == 400
        body = json.loads(response['body'])
        assert 'error' in body

    def test_returns_empty_results_for_no_matches(self):
        """Should return empty items when no activities match."""
        # Test implementation
        pass
```

### 4.2 Flutter Test Structure

**Recommendation**: Add comprehensive Flutter tests.

```dart
// test/viewmodels/activities_viewmodel_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockApiService mockApiService;
  late ActivitiesViewModel viewModel;

  setUp(() {
    mockApiService = MockApiService();
    viewModel = ActivitiesViewModel(mockApiService);
  });

  group('ActivitiesViewModel', () {
    test('search sets loading state', () async {
      when(() => mockApiService.searchActivities(any()))
          .thenAnswer((_) async => ActivitySearchResponse(items: [], nextCursor: null));

      final future = viewModel.search(ActivitySearchFilters());
      
      expect(viewModel.state.isLoading, isTrue);
      
      await future;
      
      expect(viewModel.state.isLoading, isFalse);
    });

    test('search error sets error message', () async {
      when(() => mockApiService.searchActivities(any()))
          .thenThrow(Exception('Network error'));

      await viewModel.search(ActivitySearchFilters());

      expect(viewModel.state.errorMessage, isNotNull);
      expect(viewModel.state.isLoading, isFalse);
    });
  });
}
```

---

## 5. Documentation

### 5.1 API Documentation

**Issue**: OpenAPI specs exist but could be more comprehensive.

**Recommendation**: Add examples, error responses, and more detailed descriptions.

```yaml
# docs/api/activities-search.yaml additions
paths:
  /v1/activities/search:
    get:
      summary: Search activities
      description: |
        Search for activities based on various filters including age, district,
        price range, schedule type, and languages. Results are paginated using
        cursor-based pagination ordered by schedule timing.
      responses:
        "200":
          description: Search results
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ActivitySearchResponse"
              examples:
                singleResult:
                  summary: Single activity result
                  value:
                    items:
                      - activity:
                          id: "123e4567-e89b-12d3-a456-426614174000"
                          name: "Swimming Class"
                          description: "Learn to swim"
                          age_min: 5
                          age_max: 12
                        organization:
                          id: "223e4567-e89b-12d3-a456-426614174000"
                          name: "Sports Center"
                        location:
                          id: "323e4567-e89b-12d3-a456-426614174000"
                          district: "Central"
                        pricing:
                          pricing_type: "per_class"
                          amount: 150.00
                          currency: "HKD"
                        schedule:
                          schedule_type: "weekly"
                          day_of_week_utc: 1
                          start_minutes_utc: 600
                          end_minutes_utc: 660
                          languages: ["en", "zh"]
                    next_cursor: null
        "400":
          description: Invalid request parameters
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
              example:
                error: "day_of_week_utc or day_of_month cannot be used together"
        "401":
          description: Missing or invalid authentication
        "403":
          description: Invalid device attestation token
```

### 5.2 Code Documentation

**Recommendation**: Add module-level docstrings explaining the purpose and relationships.

```python
# backend/src/app/api/activities_search.py
"""
Activity Search API Module
==========================

This module provides the activity search functionality for the mobile app.
It handles:
- Query parameter parsing and validation
- Database queries with cursor pagination
- Response serialization

Dependencies:
- app.db.queries: Query building and filters
- app.db.connection: Database connection management
- app.api.schemas: Pydantic schemas for response serialization

Usage:
    The Lambda handler is invoked by API Gateway with query parameters
    for filtering activities. Results are paginated using cursor-based
    pagination ordered by schedule timing.

Security:
    - Requires API key authentication
    - Requires device attestation token
    - Read-only database access via siutindei_app role
"""
```

---

## 6. CI/CD

### 6.1 Add Pre-commit Hooks

**Recommendation**: Add pre-commit configuration for code quality.

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.3.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.8.0
    hooks:
      - id: mypy
        additional_dependencies:
          - pydantic
          - sqlalchemy-stubs

  - repo: local
    hooks:
      - id: flutter-analyze
        name: Flutter analyze
        entry: bash -c 'cd apps/siutindei_app && flutter analyze'
        language: system
        files: '\.dart$'
        pass_filenames: false
```

### 6.2 GitHub Actions Improvements

**Recommendation**: Add caching and parallel execution.

```yaml
# .github/workflows/test.yml improvements
jobs:
  test-python:
    name: Test Python
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.13"
          cache: pip
          cache-dependency-path: backend/requirements.txt

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          python -m pip install pytest pytest-cov pytest-asyncio
          python -m pip install -r backend/requirements.txt

      - name: Run tests with coverage
        run: |
          python -m pytest tests backend \
            --cov=backend/src \
            --cov-report=xml \
            --cov-report=term-missing

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: coverage.xml
```

---

## 7. General Architecture

### 7.1 API Versioning Strategy

**Issue**: Currently using `/v1/` prefix but no strategy documented.

**Recommendation**: Document versioning strategy and add version handling.

```python
# backend/src/app/api/versioning.py
"""API versioning utilities."""

from enum import Enum
from typing import Callable, TypeVar

T = TypeVar('T')


class ApiVersion(str, Enum):
    V1 = 'v1'
    V2 = 'v2'  # Future


def versioned_handler(
    handlers: dict[ApiVersion, Callable[..., T]],
    default_version: ApiVersion = ApiVersion.V1,
) -> Callable[..., T]:
    """Create a version-aware handler dispatcher."""
    def dispatch(event, context):
        path = event.get('path', '')
        version = _extract_version(path) or default_version
        handler = handlers.get(version, handlers[default_version])
        return handler(event, context)
    return dispatch


def _extract_version(path: str) -> ApiVersion | None:
    """Extract API version from path."""
    parts = path.strip('/').split('/')
    if parts and parts[0].startswith('v'):
        try:
            return ApiVersion(parts[0])
        except ValueError:
            return None
    return None
```

### 7.2 Logging and Observability

**Issue**: Minimal logging. Add structured logging for better observability.

**Recommendation**: Add structured logging with context.

```python
# backend/src/app/utils/logging.py
import json
import logging
import os
from contextvars import ContextVar
from typing import Any

request_id: ContextVar[str] = ContextVar('request_id', default='')


class StructuredLogFormatter(logging.Formatter):
    """JSON formatter for structured logging."""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            'timestamp': self.formatTime(record),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'request_id': request_id.get(),
        }
        
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)
        
        if hasattr(record, 'extra'):
            log_data.update(record.extra)
        
        return json.dumps(log_data)


def configure_logging() -> None:
    """Configure structured logging for Lambda."""
    log_level = os.getenv('LOG_LEVEL', 'INFO')
    
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredLogFormatter())
    root_logger.handlers = [handler]


def get_logger(name: str) -> logging.Logger:
    """Get a logger with the given name."""
    return logging.getLogger(name)
```

### 7.3 Health Check Endpoint

**Recommendation**: Add a health check endpoint for monitoring.

```python
# backend/src/app/api/health.py
"""Health check endpoint."""

from __future__ import annotations

import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.engine import get_engine


def check_health() -> dict[str, Any]:
    """Perform health checks and return status."""
    checks = {
        'database': _check_database(),
        'config': _check_config(),
    }
    
    overall = all(check['healthy'] for check in checks.values())
    
    return {
        'healthy': overall,
        'checks': checks,
        'version': os.getenv('APP_VERSION', 'unknown'),
    }


def _check_database() -> dict[str, Any]:
    """Check database connectivity."""
    try:
        engine = get_engine(use_cache=True)
        with Session(engine) as session:
            session.execute(text('SELECT 1'))
        return {'healthy': True}
    except Exception as e:
        return {'healthy': False, 'error': str(e)}


def _check_config() -> dict[str, Any]:
    """Check required configuration."""
    required_vars = ['DATABASE_SECRET_ARN', 'DATABASE_NAME']
    missing = [var for var in required_vars if not os.getenv(var)]
    return {
        'healthy': len(missing) == 0,
        'missing': missing if missing else None,
    }
```

---

## 8. Security Improvements

### 8.1 Input Validation

**Recommendation**: Add comprehensive input validation.

```python
# backend/src/app/utils/validators.py
import re
from typing import Optional
from uuid import UUID


def validate_uuid(value: str, field_name: str) -> UUID:
    """Validate and parse a UUID string."""
    try:
        return UUID(value)
    except (ValueError, TypeError) as e:
        raise ValueError(f'Invalid {field_name}: must be a valid UUID') from e


def validate_email(value: str) -> str:
    """Validate an email address."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, value):
        raise ValueError('Invalid email address')
    return value.lower()


def validate_range(
    value: int,
    min_val: int,
    max_val: int,
    field_name: str,
) -> int:
    """Validate a numeric value is within range."""
    if not min_val <= value <= max_val:
        raise ValueError(f'{field_name} must be between {min_val} and {max_val}')
    return value


def sanitize_string(
    value: Optional[str],
    max_length: int = 1000,
    strip: bool = True,
) -> Optional[str]:
    """Sanitize a string input."""
    if value is None:
        return None
    if strip:
        value = value.strip()
    if len(value) > max_length:
        raise ValueError(f'Value exceeds maximum length of {max_length}')
    return value
```

### 8.2 Rate Limiting Awareness

**Recommendation**: Add rate limit headers to responses.

```python
# backend/src/app/utils/responses.py
def json_response(
    status_code: int,
    body: Any,
    headers: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Create a JSON API Gateway response with standard headers."""
    response_headers = {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
    }
    
    if headers:
        response_headers.update(headers)
    
    return {
        'statusCode': status_code,
        'headers': response_headers,
        'body': json.dumps(body, default=str),
    }
```

---

## Summary of Priority Actions

### High Priority
1. Extract duplicate utility functions to shared modules
2. Implement proper dependency injection in Flutter
3. Add comprehensive test coverage
4. Split monolithic CDK stack into constructs

### Medium Priority
5. Add custom exception types
6. Implement repository pattern for database operations
7. Add structured logging
8. Use Freezed/json_serializable in Flutter

### Low Priority
9. Add health check endpoint
10. Enhance API documentation with examples
11. Add pre-commit hooks
12. Implement API versioning strategy

---

## Implementation Roadmap

### Phase 1: Foundation (Immediate)
- Extract shared Python utilities
- Add custom exception classes
- Set up proper DI in Flutter

### Phase 2: Testing (Next)
- Add pytest fixtures and conftest
- Write unit tests for all modules
- Add Flutter widget and integration tests

### Phase 3: Infrastructure (Following)
- Refactor CDK into constructs
- Add structured logging
- Add health check endpoint

### Phase 4: Polish (Ongoing)
- Enhance documentation
- Add pre-commit hooks
- Performance optimization
