# CANsim

Interaktive CAN-Übung im Browser – Lehrmaterial zur Vorlesung *Industrielle Bussysteme* (T4EIT3101.2), DHBW Stuttgart.

## Inhalte

Die Reiter folgen dem Ablauf der Übung:

1. **Netzwerk** – High-Speed-CAN (ISO 11898-2) aufbauen: Knoten platzieren, CAN_H/CAN_L an die Busleitungen anschließen, Abschlusswiderstände setzen und dimensionieren. Live-Prüfliste (Verdrahtung, Abschluss an beiden Enden, 60 Ω, Baudrate, Buslänge, Stichleitungen), Multimeter und **Oszilloskop**. Das Oszilloskop rechnet die Leitung als Telegraphengleichung (FDTD): Reflexionen bei offenem/fehlangepasstem Ende, langsames Entladen ohne Abschluss, Abtastung am Empfänger mit 0,5/0,9-V-Schwellen.
2. **Botschaften** – Kommunikationsmatrix wie in CANdb++: ID, Format, DLC, Zykluszeit, Signale (Startbit, Länge, Intel/Motorola, Faktor, Offset, Einheit) mit Layout-Raster. Aufgabe aus Übung 2.2 (Winkelsensor) mit automatischer Prüfung, Rechner zur Signalauslegung, DBC-Export.
3. **Simulation & Trace** – Bussimulation mit Arbitrierung, ACK und Fehlerbehandlung. Joystick (Maus/Tastatur), Hubwerk-Modell mit Endlagen und Teilautomation (Übung 2.2 i), Inertialsensor MM7.10 (Übung 2.1). Trace wie im CAN-Explorer (feste Position/chronologisch, Δt, Anzahl, CSV). Nach Laden einer **DBC** werden die Signale dekodiert und in drei Grafikfenstern live geplottet (J1939-Botschaften werden über die PGN zugeordnet).
4. **Bitebene** – vollständiger Rahmen mit Feldern und Stuff-Bits, NRZ-Pegel, CRC-15 (optional schrittweise). Bit anklicken → Störung; der Empfänger dekodiert den gestörten Bitstrom wirklich und zeigt Bit-, Stuff-, CRC-, Form- oder ACK-Fehler. Arbitrierung (Wired-AND) mit 2–4 Knoten, auch aus der laufenden Simulation. Übung zum Bitstuffing.
5. **Fehler** – Error Frames (Beispiele mit 6/12/9 Flag-Bits aus der Vorlesung und der letzte Fehler aus der Simulation), Fehlerinjektion, defekter Transceiver, EMV-Störung, Fehlerprotokoll mit Ursache, TEC/REC je Knoten, Zustandsautomat (Error Active/Passive/Bus Off) mit Recovery.
6. **Checksumme & Zähler** – CRC-8 nach SAE J1850 schrittweise (wie `Test_CRC8_J1850_MM710_0x174.m`, inkl. der Trace-Beispiele), Live-Prüfung empfangener Botschaften, Ende-zu-Ende-Fehler (falscher Startwert, fehlendes XOR, falsches Polynom, Bitkipper im Gateway, eingefrorener/springender Zähler, Timeout) und automatische Fehleranalyse.
7. **Werkzeuge & Quiz** – Signalrechner, J1939-ID → PGN/SPN, CANopen-COB-ID und NMT, Buslast, Classical CAN vs. CAN FD, CAN-Versionen, Quiz.

Die Fehler aus Schritt 1 wirken direkt in der Simulation: Fehlender Abschluss, vertauschte Adern, falsche Baudrate, zu lange Leitung (verspätete ACK-Quittung) oder ein einzelner Knoten ohne Quittung führen zu Error Frames, steigenden Fehlerzählern und ggf. Bus Off.

Szenarien: *Hubwerk – Teilautomation (Übung 2.2)*, *Inertialsensor MM7.10 (Übung 2.1)*, *Freies Netzwerk*. Eingebettete Datenbanken: `BoomControl.dbc`, `BoomControl_Loesung.dbc`, `MM710_Rexroth.dbc`, J1939-Auszug (EEC1). Eigene DBC-Dateien können geladen werden.

Der Arbeitsstand wird im Browser gespeichert; *Exportieren/Importieren* sichert ihn als JSON. Oben rechts schaltet *◐ Auto / ☀ Hell / ☾ Dunkel* die Darstellung um.

## Lokal starten

`index.html` im Browser öffnen (Chrome, Edge, Firefox). Keine Installation, keine Internetverbindung, keine externen Bibliotheken.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/core.js` | Hilfsfunktionen, CAN-Rahmen (Stuffing, CRC-15, Arbitrierung), CRC-8, Signal-Packing, Szenarien, Zustand |
| `js/dbc.js` | DBC einlesen/erzeugen, eingebettete Datenbanken, J1939-PGN-Zuordnung |
| `js/phys.js` | Physikalische Schicht: Verdrahtung, Abschluss, Leitungsmodell, Abtastung |
| `js/sim.js` | Bussimulation, Fehlerzähler, Streckenmodelle, Steuerung |
| `js/plot.js` | Zeitverläufe auf Canvas |
| `js/tab-*.js` | Reiter 1–7 |

---
Prof. Dr.-Ing. Frank Bender · DHBW Stuttgart
