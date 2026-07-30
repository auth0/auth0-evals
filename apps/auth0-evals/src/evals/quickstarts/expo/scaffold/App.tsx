import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Barkbook</Text>

      {isAuthenticated ? (
        <>
          <Text>Welcome!</Text>
          <Text style={styles.caption}>{userProfile}</Text>
          <Button title="Log Out" onPress={() => {}} />
        </>
      ) : (
        <Button title="Log In" onPress={() => {}} />
      )}

      <StatusBar style="auto" />
    </View>
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
