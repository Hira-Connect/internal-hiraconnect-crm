"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateMyProfile } from "@/lib/actions/team";
import { Button, Field, Input } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import type { Profile } from "@/lib/types";

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const form = formRef.current;
        if (!form) return;
        setSaved(false);
        run(
          () => updateMyProfile(new FormData(form)),
          () => {
            setSaved(true);
            router.refresh();
          },
        );
      }}
      className="space-y-3"
    >
      <Field label="Full name" hint="Shown on the timeline and the leaderboard.">
        <Input name="full_name" defaultValue={profile.full_name ?? ""} required />
      </Field>
      <Field label="Phone">
        <Input name="phone" defaultValue={profile.phone ?? ""} />
      </Field>

      {error && <p className={actionErrorClass()}>{error}</p>}
      {saved && !error && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
