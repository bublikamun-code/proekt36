import { createRouter, createWebHistory } from 'vue-router'
import { safeInternalPath } from '../domain/auth'
import { useAuthStore } from '../stores/auth'
import { useProjectStore } from '../stores/project'
import PublicLayout from '../layouts/PublicLayout.vue'
import { applyPageMetadata, pageMetadata } from './metadata'

declare module 'vue-router' {
  interface RouteMeta {
    requiresWorkspace?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: PublicLayout,
      children: [
        { path: '', name: 'home', component: () => import('../views/HomeView.vue') },
        { path: 'features', name: 'features', component: () => import('../views/FeaturesView.vue') },
        { path: 'pricing', name: 'pricing', component: () => import('../views/PricingView.vue') },
        { path: 'demo', name: 'demo', component: () => import('../views/DemoView.vue') },
        { path: 'demo/project', name: 'demo-project', component: () => import('../views/DemoProjectView.vue') },
        { path: 'login', name: 'login', component: () => import('../views/auth/LoginView.vue') },
        { path: 'register', name: 'register', component: () => import('../views/auth/RegisterView.vue') },
        { path: 'privacy', name: 'privacy', component: () => import('../views/LegalView.vue') },
        { path: 'terms', name: 'terms', component: () => import('../views/LegalView.vue') },
      ],
    },
    {
      path: '/app',
      component: () => import('../layouts/WorkspaceLayout.vue'),
      meta: { requiresWorkspace: true },
      children: [
        { path: '', redirect: { name: 'projects' } },
        { path: 'projects', name: 'projects', component: () => import('../views/ProjectsView.vue') },
        { path: 'projects/:projectId/editor', name: 'editor', component: () => import('../views/EditorView.vue') },
        { path: 'editor', name: 'current-editor', component: () => import('../views/EditorView.vue') },
        // The rebuilt board. It carries its own route until it has earned the editor's tests.
        { path: 'board', name: 'board', component: () => import('../views/BoardWorkspaceView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'notFound', component: () => import('../views/NotFoundView.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  if (to.path === '/' && to.query.view === 'editor') return '/app/editor'

  const auth = useAuthStore()
  if (to.meta.requiresWorkspace && !auth.isUnlocked) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if ((to.name === 'login' || to.name === 'register') && auth.isUnlocked) {
    return safeInternalPath(to.query.redirect)
  }

  // Canonicalise the parameterless editor link before the view exists. The editor component is
  // loaded through a dynamic import, so doing this inside it left a window where the address bar
  // read /app/editor and then changed under the user — a refresh appeared to move them.
  if (to.name === 'current-editor') {
    const projectId = useProjectStore().currentProjectId
    if (projectId) return { name: 'editor', params: { projectId } }
    return { name: 'projects' }
  }

  return true
})

router.afterEach((to) => {
  const routeName = String(to.name || 'notFound')
  const metadata = pageMetadata[routeName] || pageMetadata.notFound!
  applyPageMetadata(metadata)
})
