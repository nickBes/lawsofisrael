import { useTopics, type Topic } from "@/db/shared"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"

// value is a topic_id, '' for "all topics"
export function TopicCombobox({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const topics = useTopics().data ?? []
  const selected = topics.find((t) => t.topic_id === value) ?? null
  return (
    <Combobox<Topic>
      items={topics}
      value={selected}
      onValueChange={(t) => onChange(t?.topic_id ?? "")}
      itemToStringLabel={(t) => t.topic_name}
      itemToStringValue={(t) => t.topic_id}
    >
      <ComboboxInput id={id} placeholder="כל התחומים" showClear />
      <ComboboxContent>
        <ComboboxEmpty>לא נמצא תחום</ComboboxEmpty>
        <ComboboxList>
          {(t: Topic) => (
            <ComboboxItem key={t.topic_id} value={t}>
              {t.topic_name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
