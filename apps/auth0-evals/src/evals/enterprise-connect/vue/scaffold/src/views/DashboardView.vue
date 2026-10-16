<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchCurrentUser, signOut } from '../api.js';

const router = useRouter();
const user = ref(null);

onMounted(async () => {
  user.value = await fetchCurrentUser();
  if (!user.value) router.replace('/signin');
});

async function handleSignOut() {
  await signOut();
  router.push('/signin');
}
</script>

<template>
  <main v-if="user">
    <h1>Welcome, {{ user.name }}</h1>
    <p>{{ user.email }}</p>
    <button @click="handleSignOut">Sign out</button>
  </main>
  <p v-else>Loading…</p>
</template>
