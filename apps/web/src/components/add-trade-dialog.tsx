"use client";

import { useState } from "react";
import { Copy, Plus } from "lucide-react";
import { ManualTradeEntry, type ManualTradeInitial } from "./manual-trade-entry";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function AddTradeDialog({
  onSaved,
  initial,
  duplicate = false,
}: {
  onSaved: () => void;
  /** Prefill the form, for example to repeat an earlier trade. */
  initial?: ManualTradeInitial;
  duplicate?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={duplicate ? "outline" : "default"}>
          {duplicate ? <Copy className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {duplicate ? "Duplicate" : "Add trade"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{duplicate ? "Duplicate trade" : "Add trade"}</DialogTitle>
          <DialogDescription>
            Choose an account and enter your buys and sells. Save an entry alone for an open
            position, or include the exit to record a closed trade.
          </DialogDescription>
        </DialogHeader>
        <ManualTradeEntry
          initial={initial}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
