# Customer App (Flutter)

## Configure Amplify

This app expects Amplify configuration via `dart-define`:

```
flutter run \
  --dart-define=AMPLIFY_CONFIG='{"auth":{...},"api":{...}}' \
  --dart-define=AMPLIFY_API_NAME=activitiesApi
```

`AMPLIFY_API_NAME` must match the REST API name in your Amplify config.

## Run

```
flutter pub get
flutter run
```
