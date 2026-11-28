import Foundation
import Security

/// Sign-in secrets (account token, owner key) live in the Keychain, not UserDefaults:
/// they stay out of unencrypted backups and are readable only after the first unlock, on this device only.
enum SecureStore {
    private static let service = "ae.sheen.straineat.auth"
    static let accessToken = "accessToken"
    static let apiKey = "apiKey"

    static func get(_ key: String) -> String? {
        migrate(key)
        var q = base(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data,
              let s = String(data: d, encoding: .utf8), !s.isEmpty else { return nil }
        return s
    }

    static func set(_ key: String, _ value: String?) {
        SecItemDelete(base(key) as CFDictionary)
        guard let value, !value.isEmpty else { return }
        var q = base(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    private static func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    /// One-time move of a value saved by an older build in UserDefaults.
    private static func migrate(_ key: String) {
        let d = UserDefaults.standard
        guard let old = d.string(forKey: key) else { return }
        d.removeObject(forKey: key)
        set(key, old.isEmpty ? nil : old) // an empty value (e.g. a launch argument) means signed out
    }
}
