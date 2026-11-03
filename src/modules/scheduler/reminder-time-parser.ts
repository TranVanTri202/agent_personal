export type RecurrenceRule = 'NONE' | 'DAILY' | 'WEEKLY' | 'WEEKDAYS' | 'MONTHLY';

export interface ParsedReminderTime {
  success: boolean;
  dueAt?: Date;
  title?: string;
  recurrence?: RecurrenceRule;
  isAmbiguous?: boolean;
  clarificationPrompt?: string;
  isReschedule?: boolean;
  extendMinutes?: number;
  isCancel?: boolean;
  rawMatched?: string;
}

export class ReminderTimeParser {
  /**
   * Parses natural language Vietnamese time phrases into an absolute Date object
   * relative to anchorTime (receivedAt).
   */
  static parse(text: string, anchorTime: Date = new Date()): ParsedReminderTime {
    const raw = text.trim();
    const lower = raw.toLowerCase();

    // 1. Check for cancel intents
    if (
      lower.startsWith('hủy') ||
      lower.includes('hủy lời nhắc') ||
      lower.includes('hủy nhắc việc') ||
      lower.includes('thôi không cần nhắc') ||
      lower.includes('thôi hủy') ||
      lower === 'hủy đi'
    ) {
      return {
        success: true,
        isCancel: true,
      };
    }

    // 2. Check for reschedule intents like "dời thêm 15 phút", "hoãn 10p"
    const extendMatch = lower.match(/(?:dời thêm|dời|hoãn thêm|hoãn|lùi lại)\s*(\d+)\s*(phút|p|tiếng|giờ|h)/);
    if (extendMatch) {
      const val = parseInt(extendMatch[1], 10);
      const unit = extendMatch[2];
      const extendMinutes = unit.includes('tiếng') || unit.includes('giờ') || unit === 'h' ? val * 60 : val;
      return {
        success: true,
        isReschedule: true,
        extendMinutes,
        dueAt: new Date(anchorTime.getTime() + extendMinutes * 60 * 1000),
      };
    }

    // 3. Check for ambiguous phrases without specific time
    const ambiguousKeywords = ['lát nữa', 'chốc nữa', 'tí nữa', 'tẹo nữa', 'hôm nào đó'];
    for (const kw of ambiguousKeywords) {
      if (lower.includes(kw) && !lower.match(/\d+\s*(?:phút|p|tiếng|giờ|h)/)) {
        return {
          success: false,
          isAmbiguous: true,
          clarificationPrompt:
            'Dạ anh/chị muốn em nhắc vào lúc mấy giờ hoặc sau bao nhiêu phút nữa ạ? (Ví dụ: sau 15 phút, hoặc lúc 16:30 nhé 😄)',
        };
      }
    }

    if (
      (lower.includes('chiều mai') ||
        lower.includes('sáng mai') ||
        lower.includes('tối mai') ||
        lower.includes('ngày mai')) &&
      !lower.match(/\d+/)
    ) {
      return {
        success: false,
        isAmbiguous: true,
        clarificationPrompt:
          'Dạ anh/chị muốn em nhắc vào lúc mấy giờ ngày mai ạ? (Ví dụ: 9h sáng mai hoặc 15h chiều mai nhé 😄)',
      };
    }

    let dueAt: Date | null = null;
    let matchedText = '';

    // 4. Pattern: "nửa tiếng nữa / sau nửa tiếng" -> +30 minutes
    if (lower.includes('nửa tiếng')) {
      dueAt = new Date(anchorTime.getTime() + 30 * 60 * 1000);
      matchedText = 'nửa tiếng';
    }

    // 5. Pattern: "X phút nữa / sau X phút / Xp nữa"
    if (!dueAt) {
      const minMatch = lower.match(/(\d+)\s*(?:phút|p|m|min|minute|minutes)\s*(?:nữa|sau)?/);
      if (minMatch) {
        const mins = parseInt(minMatch[1], 10);
        dueAt = new Date(anchorTime.getTime() + mins * 60 * 1000);
        matchedText = minMatch[0];
      }
    }

    // 6. Pattern: "X tiếng nữa / X giờ nữa / sau X tiếng"
    if (!dueAt) {
      const hourMatch = lower.match(/(\d+)\s*(?:tiếng|giờ|h|hour|hours)\s*(?:nữa|sau)?/);
      if (hourMatch && !lower.includes('lúc')) {
        const hours = parseInt(hourMatch[1], 10);
        dueAt = new Date(anchorTime.getTime() + hours * 3600 * 1000);
        matchedText = hourMatch[0];
      }
    }

    // 7. Pattern: "lúc XhY / lúc X:Y" (e.g. "lúc 16h", "lúc 16h30", "lúc 9:15")
    if (!dueAt) {
      const timeMatch = lower.match(/lúc\s*(\d{1,2})(?:h|:)(\d{1,2})?/);
      if (timeMatch) {
        const hour = parseInt(timeMatch[1], 10);
        const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const target = new Date(anchorTime);
        target.setHours(hour, minute, 0, 0);

        // If target is earlier than anchorTime, assume tomorrow
        if (target.getTime() <= anchorTime.getTime()) {
          target.setDate(target.getDate() + 1);
        }
        dueAt = target;
        matchedText = timeMatch[0];
      }
    }

    // 8. Pattern: "mai Xh / sáng mai Xh / chiều mai Xh"
    if (!dueAt) {
      const tomorrowMatch = lower.match(/(?:sáng mai|chiều mai|tối mai|mai)\s*(?:lúc\s*)?(\d{1,2})(?:h|:)?(\d{1,2})?/);
      if (tomorrowMatch) {
        let hour = parseInt(tomorrowMatch[1], 10);
        const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
        if (lower.includes('chiều mai') && hour < 12) {
          hour += 12;
        }
        const target = new Date(anchorTime);
        target.setDate(target.getDate() + 1);
        target.setHours(hour, minute, 0, 0);
        dueAt = target;
        matchedText = tomorrowMatch[0];
      }
    }

    if (!dueAt) {
      return { success: false };
    }

    // Clean up title from original text
    let title = raw;
    if (matchedText) {
      title = title.replace(new RegExp(matchedText, 'i'), '');
    }

    // Clean common prefixes
    title = title
      .replace(/^(nhắc|kêu|báo|gọi|hãy nhắc|nhớ nhắc|đặt lịch|lên lịch)\s*/i, '')
      .replace(/^(cho tôi|cho anh|cho em|cho mình|tôi|anh|em|mình)\s*/i, '')
      .replace(/\s*(nhé|nha|với|giúp tôi|giúp anh|giúp em|nữa|sau)$/i, '')
      .trim();

    if (!title || title.length === 0) {
      title = 'công việc đã hẹn';
    }

    const recurrence = ReminderTimeParser.detectRecurrence(lower);

    return {
      success: true,
      dueAt,
      title,
      recurrence,
      rawMatched: matchedText,
    };
  }

  static detectRecurrence(text: string): RecurrenceRule {
    const lower = text.toLowerCase();
    if (
      lower.includes('thứ 2 đến thứ 6') ||
      lower.includes('thứ hai đến thứ sáu') ||
      lower.includes('ngày làm việc') ||
      lower.includes('weekdays')
    ) {
      return 'WEEKDAYS';
    }
    if (
      lower.includes('hàng ngày') ||
      lower.includes('hằng ngày') ||
      lower.includes('mỗi ngày') ||
      lower.includes('mỗi sáng') ||
      lower.includes('mỗi tối') ||
      lower.includes('mỗi trưa') ||
      lower.includes('mỗi chiều')
    ) {
      return 'DAILY';
    }
    if (lower.includes('hàng tuần') || lower.includes('hằng tuần') || lower.includes('mỗi tuần')) {
      return 'WEEKLY';
    }
    if (lower.includes('hàng tháng') || lower.includes('hằng tháng') || lower.includes('mỗi tháng')) {
      return 'MONTHLY';
    }
    return 'NONE';
  }

  static computeNextDueAt(currentDueAt: Date, recurrence: RecurrenceRule): Date | null {
    if (!recurrence || recurrence === 'NONE') return null;
    const next = new Date(currentDueAt.getTime());
    const now = Date.now();

    const advanceOnce = (d: Date) => {
      if (recurrence === 'DAILY') {
        d.setDate(d.getDate() + 1);
      } else if (recurrence === 'WEEKLY') {
        d.setDate(d.getDate() + 7);
      } else if (recurrence === 'MONTHLY') {
        d.setMonth(d.getMonth() + 1);
      } else if (recurrence === 'WEEKDAYS') {
        do {
          d.setDate(d.getDate() + 1);
        } while (d.getDay() === 0 || d.getDay() === 6);
      }
    };

    advanceOnce(next);
    while (next.getTime() <= now) {
      advanceOnce(next);
    }
    return next;
  }

  static encodeNoteWithRecurrence(note?: string | null, recurrence?: RecurrenceRule): string | null {
    const cleanNote = (note || '').replace(/\[RECUR:[A-Z]+\]\s*/g, '').trim();
    if (recurrence && recurrence !== 'NONE') {
      return cleanNote ? `[RECUR:${recurrence}] ${cleanNote}` : `[RECUR:${recurrence}]`;
    }
    return cleanNote || null;
  }

  static extractRecurrenceFromNote(note?: string | null): { recurrence: RecurrenceRule; cleanNote: string | null } {
    if (!note) return { recurrence: 'NONE', cleanNote: null };
    const match = note.match(/\[RECUR:(DAILY|WEEKLY|WEEKDAYS|MONTHLY)\]/i);
    const recurrence = match ? (match[1].toUpperCase() as RecurrenceRule) : 'NONE';
    const cleanNote = note.replace(/\[RECUR:[A-Z]+\]\s*/gi, '').trim() || null;
    return { recurrence, cleanNote };
  }
}
