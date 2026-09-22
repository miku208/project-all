import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

/// ============================================================
/// SenderModePicker — pilihan 2 opsi sender saat mau kirim bug:
///   📱 Sender Pribadi  (selalu tersedia)
///   🌐 Sender Global   (VIP/Owner/Reseller/Admin, disable jika kosong)
///
/// Cara pakai di layar kirim bug APK:
///   SenderMode selectedMode = SenderMode.private;
///
///   SenderModePicker(
///     sessionKey: mySessionKey,
///     baseUrl: 'https://ashimusic.biz.id/apidv',
///     initial: selectedMode,
///     onChanged: (mode) => setState(() => selectedMode = mode),
///   )
///
/// Lalu saat panggil /sendBug tambahkan param sender:
///   final senderParam = selectedMode == SenderMode.global ? 'global' : 'private';
///   GET $baseUrl/sendBug?key=$key&bug=$bug&target=$target&sender=$senderParam
///
/// Server juga memvalidasi ulang: jika global kosong/ditolak, respons
/// berisi senderDenied/senderEmpty=true dan cooldown TIDAK terpakai.
/// ============================================================

enum SenderMode { private, global }

class SenderModePicker extends StatefulWidget {
  const SenderModePicker({
    super.key,
    required this.sessionKey,
    this.baseUrl = 'https://ashimusic.biz.id/apidv',
    this.initial = SenderMode.private,
    required this.onChanged,
    this.enabled = true,
  });

  final String sessionKey;
  final String baseUrl;
  final SenderMode initial;
  final ValueChanged<SenderMode> onChanged;

  /// set false saat proses kirim berjalan
  final bool enabled;

  @override
  State<SenderModePicker> createState() => _SenderModePickerState();
}

class _SenderModePickerState extends State<SenderModePicker> {
  SenderMode _selected = SenderMode.private;
  bool _canUseGlobal = false;
  int _onlineCount = 0;
  int _totalCount = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _selected = widget.initial;
    _fetch();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _fetch());
  }

  @override
  void didUpdateWidget(covariant SenderModePicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.sessionKey != widget.sessionKey) _fetch();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _fetch() async {
    try {
      final data = await GlobalSenderApi.fetchStatus(widget.baseUrl, widget.sessionKey);
      if (!mounted) return;
      setState(() {
        _canUseGlobal = data['canUse'] == true;
        _totalCount = (data['total'] as num?)?.toInt() ?? 0;
        _onlineCount = (data['onlineCount'] as num?)?.toInt() ?? 0;
      });

      // Auto-fallback: kalau sedang pilih global lalu global kosong → balik ke pribadi
      if (_selected == SenderMode.global && !_globalAvailable) {
        _selected = SenderMode.private;
        widget.onChanged(_selected);
      }
    } catch (_) {
      // diam — picker tetap jalan dengan status terakhir
    }
  }

  bool get _globalAvailable => _canUseGlobal && _onlineCount > 0;

  String get _globalDisableReason {
    if (!_canUseGlobal) return 'Khusus VIP, Owner, Reseller & Admin';
    if (_onlineCount == 0) return 'Tidak ada sender global online';
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('Pilih Sender', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        Row(
          children: [
            // ===== OPsi 1: Sender Pribadi =====
            Expanded(child: _modeCard(context, mode: SenderMode.private)),
            const SizedBox(width: 10),
            // ===== OPsi 2: Sender Global =====
            Expanded(child: _modeCard(context, mode: SenderMode.global)),
          ],
        ),
      ],
    );
  }

  Widget _modeCard(BuildContext context, {required SenderMode mode}) {
    final theme = Theme.of(context);
    final isGlobal = mode == SenderMode.global;
    final available = !isGlobal || _globalAvailable;
    final selected = _selected == mode;

    final color = isGlobal ? Colors.purple : Colors.blue;
    final disabled = !available || !widget.enabled;

    return Opacity(
      opacity: disabled ? .55 : 1,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: disabled
            ? null
            : () {
                setState(() => _selected = mode);
                widget.onChanged(mode);
              },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: selected
                ? color.withOpacity(.15)
                : theme.colorScheme.surfaceVariant.withOpacity(.35),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? color : Colors.transparent,
              width: 1.6,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(isGlobal ? '🌐' : '📱',
                      style: const TextStyle(fontSize: 16)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      isGlobal ? 'Global' : 'Pribadi',
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ),
                  if (!available)
                    const Icon(Icons.lock_outline, size: 14, color: Colors.grey),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                isGlobal
                    ? (available
                        ? '$_onlineCount/$_totalCount online'
                        : _globalDisableReason)
                    : 'Pakai nomor sender milikmu',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: available
                      ? (isGlobal ? Colors.green : Colors.blue)
                      : Colors.grey,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// ============================================================
/// Helper API sender global — dipakai picker & halaman kelola
/// ============================================================
class GlobalSenderApi {
  static Future<Map<String, dynamic>> fetchStatus(
      String baseUrl, String key) async {
    final body = await _get('$baseUrl/globalSenders?key=${Uri.encodeComponent(key)}');
    return body;
  }

  /// Tambah sender global (owner/admin): paste isi creds.json
  static Future<Map<String, dynamic>> addSender(
      String baseUrl, String key, String credsJson) async {
    final uri = Uri.parse('$baseUrl/addGlobalSender');
    final httpClient = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    final req = await httpClient.postUrl(uri);
    req.headers.set('Content-Type', 'application/json');
    req.write(jsonEncode({
      'key': key,
      'creds': jsonDecode(credsJson), // validasi JSON di sini (lempar error jika tidak valid)
    }));
    final resp = await req.close();
    final body = await resp.transform(utf8.decoder).join();
    httpClient.close();
    return jsonDecode(body) as Map<String, dynamic>;
  }

  /// Hapus sender global (owner/admin) — nomor boleh versi ter-sensor
  static Future<Map<String, dynamic>> deleteSender(
      String baseUrl, String key, String numberMasked) async {
    final uri = Uri.parse('$baseUrl/delGlobalSender');
    final httpClient = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    final req = await httpClient.postUrl(uri);
    req.headers.set('Content-Type', 'application/json');
    req.write(jsonEncode({'key': key, 'number': numberMasked}));
    final resp = await req.close();
    final body = await resp.transform(utf8.decoder).join();
    httpClient.close();
    return jsonDecode(body) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> _get(String url) async {
    final httpClient = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    final req = await httpClient.getUrl(Uri.parse(url));
    final resp = await req.close();
    final body = await resp.transform(utf8.decoder).join();
    httpClient.close();
    return jsonDecode(body) as Map<String, dynamic>;
  }
}
