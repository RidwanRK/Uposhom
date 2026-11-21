// Entry point. The Notifee background handler must be registered before the app mounts so reminder
// action buttons work with the app closed.
import './src/notifications/background';
import 'expo-router/entry';
