import { StatusBar } from 'expo-status-bar';
import { View, Text, Button, StyleSheet } from 'react-native';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';

const CUSTOM_SCHEME = 'barkbook';

function Screen() {
  const { authorize, clearSession, user, isLoading, error } = useAuth0();

  const onLogin = async () => {
    await authorize({}, { customScheme: CUSTOM_SCHEME });
  };

  const onLogout = async () => {
    await clearSession({}, { customScheme: CUSTOM_SCHEME });
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Barkbook</Text>

      {user ? (
        <>
          <Text>Welcome, {user.name}!</Text>
          <Text style={styles.caption}>{user.email}</Text>
          <Button title="Log Out" onPress={onLogout} />
        </>
      ) : (
        <Button title="Log In" onPress={onLogin} />
      )}

      {error ? <Text style={styles.caption}>{error.message}</Text> : null}

      <StatusBar style="auto" />
    </View>
  );
}

export default function App() {
  return (
    <Auth0Provider domain="dev-barkbook.us.auth0.com" clientId="barkbook_client_abc123xyz">
      <Screen />
    </Auth0Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  caption: {
    fontSize: 12,
  },
});
