/**
 * @format
 */

import { useState } from 'react';
import { Button, StatusBar, StyleSheet, Text, View } from 'react-native';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState('');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
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

export default App;
