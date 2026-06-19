import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import TransferView from '../views/TransferView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: HomeView,
    },
    {
      path: '/transfer',
      component: TransferView,
    },
  ],
});

export default router;
