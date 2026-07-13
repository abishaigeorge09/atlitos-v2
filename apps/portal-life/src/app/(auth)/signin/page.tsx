import { Suspense } from "react";

import { AuthForm } from "@/components/auth-form";

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Track your application, wishlist and gratitude posts.
        </p>
      </div>
      <Suspense>
        <AuthForm mode="signin" />
      </Suspense>
    </div>
  );
}
