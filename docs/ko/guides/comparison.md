# 기본 RN와의 비교

Granite는 React Native를 기반으로 만들어졌지만, 기본 React Native 개발과 비교했을 때 다음과 같은 장점이 있어요.

|                | Granite                                  | 기본 React Native               |
| -------------- | ---------------------------------------- | ------------------------------- |
| 아키텍처       | 마이크로서비스, 독립적으로 빌드하고 배포 | 모놀리식, 전체 앱을 하나로 빌드 |
| 기존 앱과 통합 | 쉬움                                     | 어려움                          |
| JS 빌드        | 몇 초 내외                               | 몇 분 이상                      |
| 번들 크기      | 서비스당 200KB까지 축소 가능             | 1-5MB 이상                      |
| 번들러         | ESBuild                                  | Metro                           |
| OTA 업데이트   | 기본 내장                                | 외부 솔루션 필요                |
| 네이티브 빌드  | 미리 빌드해서 빠름                       | 가장 처음부터 빌드해서 느림     |
