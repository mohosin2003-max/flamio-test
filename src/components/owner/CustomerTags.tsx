/** Simple staff-facing tags on a customer. */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { crmSetTag } from "@/lib/crm.functions";

export function CustomerTags({
  crmId,
  tags,
  canManage,
  onChanged,
}: {
  crmId: string | null;
  tags: string[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const setTag = useServerFn(crmSetTag);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const change = async (tagName: string, attach: boolean) => {
    if (!crmId) return;
    setSaving(true);
    try {
      await setTag({ data: { crmId, name: tagName, attach } });
      setName("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this tag");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="font-display text-base font-bold">Tags</h3>

        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                {canManage ? (
                  <button type="button" onClick={() => void change(tag, false)} aria-label={`Remove ${tag}`}>
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </Badge>
            ))}
          </div>
        )}

        {canManage ? (
          <div className="flex gap-2">
            <Input
              value={name}
              placeholder="New tag"
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              size="sm"
              disabled={saving || name.trim().length < 2}
              onClick={() => void change(name, true)}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
