import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface FaktumSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface FaktumSelectProps {
  id?: string;
  name?: string;
  ariaLabel?: string;
  value: string;
  options: FaktumSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  minWidth?: number | string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}

const supportsNativeBaseSelect =
  typeof window !== 'undefined' &&
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('appearance', 'base-select');

export const FaktumSelect: React.FC<FaktumSelectProps> = ({
  id,
  name,
  ariaLabel,
  value,
  options,
  placeholder = '— Seleccionar —',
  disabled = false,
  minWidth,
  onChange,
  onOpenChange,
}) => {
  const autoId = useId();
  const controlId = id ?? autoId;
  const listboxId = `${controlId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const setOpenSafe = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenSafe(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpenSafe(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, options, value]);

  // Scroll active option into view during keyboard navigation
  useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // On Chromium 135+ / Edge 135+ / Safari 27+, use native CSS customizable <select> (appearance: base-select)
  if (supportsNativeBaseSelect) {
    return (
      <select
        id={controlId}
        name={name ?? controlId}
        aria-label={ariaLabel}
        className="faktum-native-select"
        style={minWidth ? { minWidth } : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpenSafe(true);
      } else {
        setActiveIndex((prev) => Math.min(options.length - 1, prev + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpenSafe(true);
      } else {
        setActiveIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      const chosen = options[activeIndex];
      if (chosen) {
        onChange(chosen.value);
      }
      setOpenSafe(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpenSafe(true);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`faktum-select ${open ? 'is-open' : ''}`}
      style={minWidth ? { minWidth } : undefined}
    >
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        className={`faktum-select-trigger ${!selectedOption || selectedOption.value === '' ? 'is-placeholder' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpenSafe(!open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="faktum-select-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={15} className="faktum-select-chevron" aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={controlId}
          className="faktum-select-menu"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`faktum-select-option ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpenSafe(false);
                  triggerRef.current?.focus();
                }}
              >
                <span className="faktum-select-option-main">
                  <span className="faktum-select-option-label">{opt.label}</span>
                  {opt.hint && <span className="faktum-select-option-hint">{opt.hint}</span>}
                </span>
                {isSelected && (
                  <Check size={14} className="faktum-select-check" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
