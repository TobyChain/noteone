import Foundation
import UserNotifications

/// Manages daily report scheduling via local notifications.
/// The notification fires at the user's preferred time (default 20:00).
/// Tapping the notification triggers report generation in the app.
actor ReportScheduler {
    static let shared = ReportScheduler()

    private let notificationId = "noteone-daily-report"
    private let calendar = Calendar(identifier: .gregorian)

    /// Schedule (or reschedule) the daily report notification.
    /// - Parameter hour: Hour of day in 24h format (0-23), default 20.
    /// - Parameter minute: Minute of hour (0-59), default 0.
    func schedule(hour: Int = 20, minute: Int = 0) async {
        let center = UNUserNotificationCenter.current()

        // Request permission if not yet granted
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            do {
                _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            } catch {
                print("[ReportScheduler] Authorization denied: \(error)")
                return
            }
        }

        // Remove existing schedule
        center.removePendingNotificationRequests(withIdentifiers: [notificationId])

        // Build the notification content
        let content = UNMutableNotificationContent()
        content.title = "📊 今日灵感报告"
        content.body = "Notty 已准备好为你整理今天的笔记灵感，点击查看详情"
        content.sound = .default
        content.categoryIdentifier = "DAILY_REPORT"
        content.userInfo = ["type": "daily_report"]

        // Schedule at the specified time daily
        var dateComponents = DateComponents()
        dateComponents.hour = hour
        dateComponents.minute = minute

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
        let request = UNNotificationRequest(identifier: notificationId, content: content, trigger: trigger)

        do {
            try await center.add(request)
            print("[ReportScheduler] Scheduled daily at \(hour):\(String(format: "%02d", minute))")
        } catch {
            print("[ReportScheduler] Failed to schedule: \(error)")
        }
    }

    /// Cancel the daily report notification.
    func cancel() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [notificationId])
        print("[ReportScheduler] Cancelled")
    }

    /// Check if the daily report notification is currently scheduled.
    func isScheduled() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        return pending.contains { $0.identifier == notificationId }
    }
}

// MARK: - UserDefaults keys for report preferences

extension UserDefaults {
    private enum Keys {
        static let reportHour = "reportScheduleHour"
        static let reportMinute = "reportScheduleMinute"
        static let reportStyle = "reportStyle"
        static let reportDepth = "reportDepth"
        static let reportEnabled = "reportEnabled"
    }

    var reportHour: Int {
        get {
            let v = integer(forKey: Keys.reportHour)
            return v == 0 ? 20 : v  // default 20:00
        }
        set { set(newValue, forKey: Keys.reportHour) }
    }

    var reportMinute: Int {
        get { integer(forKey: Keys.reportMinute) }
        set { set(newValue, forKey: Keys.reportMinute) }
    }

    var reportStyle: ReportStyle {
        get {
            guard let raw = string(forKey: Keys.reportStyle),
                  let style = ReportStyle(rawValue: raw) else { return .minimal }
            return style
        }
        set { set(newValue.rawValue, forKey: Keys.reportStyle) }
    }

    var reportDepth: ReportDepth {
        get {
            guard let raw = string(forKey: Keys.reportDepth),
                  let depth = ReportDepth(rawValue: raw) else { return .brief }
            return depth
        }
        set { set(newValue.rawValue, forKey: Keys.reportDepth) }
    }

    var reportEnabled: Bool {
        get {
            // Default to true if never set (first launch)
            if object(forKey: Keys.reportEnabled) == nil { return true }
            return bool(forKey: Keys.reportEnabled)
        }
        set { set(newValue, forKey: Keys.reportEnabled) }
    }
}
