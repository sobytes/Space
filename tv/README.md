# tv/

Television clients. Neither is started.

| Folder | Intended stack |
|---|---|
| `ios/` | tvOS, SwiftUI + SceneKit, consuming `mobile/ios/SolarKit` |
| `android/` | Android TV, sharing whatever `mobile/android` builds |

`tv/ios` will add a second target to `mobile/ios/project.yml` rather than duplicating the
Swift. SolarKit is a package, not a folder of app sources, precisely so a second Apple target
can depend on it without a copy. If a third Apple target ever appears, lift SolarKit out of
`mobile/ios/` to a shared location at that point and not before.

A ten-foot interface is a different product, not a scaled-up phone. Focus-driven navigation,
no pointer, and text that reads at three metres. Read `contracts/` first; the physics rules
are identical and only the presentation differs.
