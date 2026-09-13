'use client';

import { Check, ChevronDown } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef } from 'react';

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  ariaLabel: string;
  value: string;
  options: readonly SelectMenuOption[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}

export function SelectMenu({
  ariaLabel,
  value,
  options,
  onChange,
  className = '',
  disabled = false,
  required = false,
  placeholder = 'Select an option',
}: SelectMenuProps) {
  const details = useRef<HTMLDetailsElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const optionElements = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex]!.label : placeholder;

  function close(focusTrigger = false) {
    details.current?.removeAttribute('open');
    if (focusTrigger) trigger.current?.focus();
  }

  function focusOption(index: number) {
    optionElements.current[index]?.focus();
  }

  function focusBoundary(fromEnd: boolean) {
    const start = fromEnd ? options.length - 1 : 0;
    const step = fromEnd ? -1 : 1;
    for (let index = start; index >= 0 && index < options.length; index += step) {
      if (!options[index]?.disabled) {
        focusOption(index);
        return;
      }
    }
  }

  function moveFocus(currentIndex: number, direction: -1 | 1) {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (currentIndex + direction * offset + options.length) % options.length;
      if (!options[index]?.disabled) {
        focusOption(index);
        return;
      }
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    if (details.current) details.current.open = true;
    const fallbackIndex = event.key === 'ArrowDown' ? 0 : options.length - 1;
    window.requestAnimationFrame(() => {
      const preferredIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : fallbackIndex;
      if (options[preferredIndex]?.disabled) focusBoundary(event.key === 'ArrowUp');
      else focusOption(preferredIndex);
    });
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(index, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusBoundary(event.key === 'End');
    }
  }

  useEffect(() => {
    function dismissOnPointerDown(event: PointerEvent) {
      if (details.current?.open && !details.current.contains(event.target as Node)) close();
    }
    function dismissOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && details.current?.open) close(true);
    }
    document.addEventListener('pointerdown', dismissOnPointerDown);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, []);

  return (
    <details className={`group relative ${className}`} ref={details}>
      <summary
        ref={trigger}
        className={`flex min-h-11 w-full list-none items-center justify-between gap-3 rounded-[10px] border border-line bg-card px-[13px] py-2.5 text-left text-sm font-semibold text-ink outline-none transition-[border-color,box-shadow,background-color] duration-150 select-none [&::-webkit-details-marker]:hidden ${
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-line-strong hover:bg-card-hover focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]'
        }`}
        aria-label={`${ariaLabel}: ${selectedLabel}`}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-disabled={disabled}
        aria-required={required}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="shrink-0 text-muted transition-transform group-open:rotate-180" size={15} />
      </summary>
      <div
        className="absolute z-40 mt-2 max-h-72 min-w-full overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-float"
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
      >
        {options.length === 0 ? (
          <div className="px-3 py-2.5 text-sm text-muted">No options available</div>
        ) : (
          options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  selected ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-ink hover:bg-card-hover'
                }`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
                ref={(element) => {
                  optionElements.current[index] = element;
                }}
                onClick={() => {
                  onChange(option.value);
                  close(true);
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="whitespace-nowrap">{option.label}</span>
                {selected && <Check className="shrink-0" size={15} strokeWidth={2.5} />}
              </button>
            );
          })
        )}
      </div>
    </details>
  );
}
