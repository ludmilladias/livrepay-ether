import type { ReactNode } from "react";
import { useController, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldId, type OnboardingFormValues } from "./onboarding-schema";

type Name = keyof OnboardingFormValues;

interface ShellProps {
  name: Name;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}

/** Rótulo associado, dica e erro (aria-invalid/aria-describedby) de um campo. */
function FieldShell({ name, label, hint, error, optional, children }: ShellProps) {
  const id = fieldId(name);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (opcional)</span>}
      </Label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps {
  name: Name;
  label: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  type?: "text" | "email" | "date" | "url";
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
  autoComplete?: string;
  mask?: (value: string) => string;
  min?: string;
  max?: string;
  maxLength?: number;
}

export function TextField({
  name, label, hint, optional, placeholder, type = "text", inputMode, autoComplete, mask, min, max, maxLength,
}: TextFieldProps) {
  const { control } = useFormContext<OnboardingFormValues>();
  const { field, fieldState } = useController({ name, control });

  return (
    <FieldShell name={name} label={label} hint={hint} error={fieldState.error?.message} optional={optional}>
      {(a11y) => (
        <Input
          {...a11y}
          ref={field.ref}
          name={field.name}
          value={field.value ?? ""}
          onBlur={field.onBlur}
          onChange={(e) => field.onChange(mask ? mask(e.target.value) : e.target.value)}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          min={min}
          max={max}
          maxLength={maxLength}
        />
      )}
    </FieldShell>
  );
}

interface SelectFieldProps {
  name: Name;
  label: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  options: readonly { value: string; label: string }[];
}

export function SelectField({ name, label, hint, optional, placeholder = "Selecione", options }: SelectFieldProps) {
  const { control } = useFormContext<OnboardingFormValues>();
  const { field, fieldState } = useController({ name, control });

  return (
    <FieldShell name={name} label={label} hint={hint} error={fieldState.error?.message} optional={optional}>
      {(a11y) => (
        <Select value={field.value || undefined} onValueChange={field.onChange} name={field.name}>
          <SelectTrigger {...a11y} ref={field.ref} onBlur={field.onBlur}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  );
}
