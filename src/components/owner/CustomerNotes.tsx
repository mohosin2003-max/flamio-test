/** Internal staff notes on a customer. Never visible to customers. */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { crmAddNote, crmDeleteNote } from "@/lib/crm.functions";
import type { CrmNote } from "@/lib/crm.functions";

export function CustomerNotes({
  crmId,
  notes,
  canManage,
  onChanged,
}: {
  crmId: string | null;
  notes: CrmNote[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const addNote = useServerFn(crmAddNote);
  const removeNote = useServerFn(crmDeleteNote);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!crmId) return;
    setSaving(true);
    try {
      await addNote({ data: { crmId, body } });
      setBody("");
      onChanged();
      toast.success("Note saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this note");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (noteId: string) => {
    try {
      await removeNote({ data: { noteId } });
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove this note");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="font-display text-base font-bold">Internal notes</h3>
        <p className="text-xs text-muted-foreground">Only your team can see these.</p>

        {canManage ? (
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={body}
              placeholder="Add a note about this customer"
              onChange={(e) => setBody(e.target.value)}
            />
            <Button size="sm" disabled={saving || body.trim().length < 2} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save note
            </Button>
          </div>
        ) : null}

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">{note.body}</p>
                  <p className="text-xs text-muted-foreground">{note.createdAt.slice(0, 10)}</p>
                </div>
                {canManage ? (
                  <Button size="icon" variant="ghost" onClick={() => void remove(note.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
