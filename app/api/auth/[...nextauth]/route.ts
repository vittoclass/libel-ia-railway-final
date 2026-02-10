import NextAuth, { type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { createClient } from "@supabase/supabase-js"

// ✅ Cliente Supabase SOLO SERVER
const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } }
)

// ✅ OJO: NO exportar authOptions desde route.ts
const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        name: { label: "Nombre", type: "text" },
        school: { label: "Institución", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const { data, error } = await supabaseServer.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        })

        if (!error && data.user) {
          const { data: profile } = await supabaseServer
            .from("users")
            .select("name, school")
            .eq("id", data.user.id)
            .single()

          return {
            id: data.user.id,
            email: data.user.email,
            name: (profile as any)?.name || credentials.name,
            school: (profile as any)?.school || credentials.school,
          }
        }

        if (credentials.name && credentials.school) {
          const { data: newUser, error: signUpError } =
            await supabaseServer.auth.signUp({
              email: credentials.email,
              password: credentials.password,
              options: {
                data: {
                  name: credentials.name,
                  school: credentials.school,
                },
              },
            })

          if (!signUpError && newUser.user) {
            await supabaseServer.from("users").upsert({
              id: newUser.user.id,
              email: credentials.email,
              name: credentials.name,
              school: credentials.school,
            })

            return {
              id: newUser.user.id,
              email: newUser.user.email ?? credentials.email,
              name: credentials.name,
              school: credentials.school,
            }
          }
        }

        return null
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.school = user.school
      }
      return token
    },

    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.id
        session.user.name = token.name
        session.user.school = token.school
      }
      return session
    },
  },

  pages: { signIn: "/login" },

  session: { strategy: "jwt" },

  secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
