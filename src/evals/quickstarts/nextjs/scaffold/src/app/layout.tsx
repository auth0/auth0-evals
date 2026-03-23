// TODO: Create a separate 'use client' provider component (e.g. app/providers.tsx)
// that wraps children with UserProvider from @auth0/nextjs-auth0/client.
// Import and render that provider here to keep this layout as a Server Component.

export const metadata = {
  title: 'Barkbook',
  description: 'A social network for dogs',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {/* TODO: Wrap children with a client-side provider component */}
        {children}
      </body>
    </html>
  )
}
