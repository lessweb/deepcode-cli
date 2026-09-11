#!/usr/bin/env python3
"""Estimate, upload materials, submit and poll MiniMax H3 video tasks."""

import argparse
import json
import mimetypes
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE_URL = 'https://deepcode.vegamo.cn/api'
SETTINGS_PATH = Path.home() / '.deepcode-plus/settings.json'
UPLOAD_PREFIX = 'deepcode-plus/video-input/'
PUBLIC_BASE_URL = 'http://files.vegamo.cn'
MAX_UPLOAD_SIZE = 50 * 1024 * 1024
MAX_FRAME_SIZE = 10 * 1024 * 1024
POLL_INTERVAL_SECONDS = 10
MAX_POLL_MINUTES = 30
RATIOS = ('auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16')


class VideoError(RuntimeError):
    def __init__(self, message, status=0, retry_after=0):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def load_key(path):
    try:
        key = json.loads(path.expanduser().read_text(encoding='utf-8'))['env']['PLUS_API_KEY']
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise VideoError(f'请在 {path} 配置 env.PLUS_API_KEY。') from exc
    if not isinstance(key, str) or not key.strip():
        raise VideoError('env.PLUS_API_KEY 不能为空。')
    return key.strip()


def request_result(method, path, *, payload=None, api_key=None, timeout: float = 90):
    headers = {'Accept': 'application/json'}
    if api_key:
        headers['PLUS-API-KEY'] = api_key
    data = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(payload).encode('utf-8')
    req = Request(BASE_URL + path, data=data, headers=headers, method=method)
    status, retry_after = 200, 0
    try:
        with build_opener(NoRedirect()).open(req, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as exc:
        status = exc.code
        delay = exc.headers.get('Retry-After', '')
        retry_after = int(delay) if delay.isdigit() else 0
        raw = exc.read()
    except (URLError, OSError, TimeoutError) as exc:
        raise VideoError(f'网络请求失败（{type(exc).__name__}）。') from exc
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise VideoError(f'接口返回非 JSON 内容，HTTP {status}。', status, retry_after) from exc
    if not 200 <= status < 300 or not isinstance(body, dict) or body.get('success') is not True:
        reason = body.get('reason') or body.get('message') if isinstance(body, dict) else None
        message = str(reason or f'接口请求失败，HTTP {status}。')
        if api_key:
            message = message.replace(api_key, '[REDACTED]')
        raise VideoError(message, status, retry_after)
    result = body.get('result')
    if not isinstance(result, dict):
        raise VideoError('接口响应缺少 result 对象。')
    return result


def calculate_cost(payload):
    query = urlencode({k: payload[k] for k in ('duration', 'resolution', 'tier')})
    result = request_result('GET', '/plugin/calc-video-gen-cost?' + query)
    for field in ('credits', 'minMinutes'):
        if type(result.get(field)) is not int or result[field] < 0:
            raise VideoError(f'试算响应缺少有效 {field}。')
    if not isinstance(result.get('uptoken'), str) or not result['uptoken'].strip():
        raise VideoError('试算响应缺少 uptoken。')
    return result


def build_payload(args):
    if not args.prompt.strip():
        raise VideoError('提示词不能为空。')
    if len(args.image) > 4 or len(args.audio) > 2:
        raise VideoError('参考素材最多 4 张图片、1 个视频、2 个音频。')
    if (args.first_frame or args.last_frame) and (args.image or args.video or args.audio):
        raise VideoError('首尾帧与参考素材互斥。')
    if args.last_frame and not args.first_frame:
        raise VideoError('尾帧必须与首帧一起提供。')
    payload = dict(content=args.prompt.strip(), aspectRatio=args.ratio,
                   resolution=args.resolution, duration=args.duration, tier=args.tier)
    for field, value in [('imageUrl', args.first_frame), ('lastFrameUrl', args.last_frame),
                         ('referenceImageUrls', args.image), ('referenceVideoUrl', args.video),
                         ('referenceAudioUrls', args.audio)]:
        if value:
            payload[field] = value
    return payload


def validate_file(path, kind, frame=False):
    """Check local file size and extension; pixel requirements live in SKILL.md."""
    if not path.is_file():
        raise VideoError(f'素材文件不存在：{path}')
    limit = MAX_FRAME_SIZE if frame else MAX_UPLOAD_SIZE
    if not 0 < path.stat().st_size <= limit:
        raise VideoError(f'素材不能为空且不能超过 {limit // (1024 * 1024)} MiB：{path.name}')
    mime = mimetypes.guess_type(path.name)[0]
    if not mime or not mime.startswith(kind + '/'):
        raise VideoError(f'素材须为 {kind} 类型：{path.name}')
    if frame and mime not in ('image/jpeg', 'image/png', 'image/webp'):
        raise VideoError('首尾帧须为 JPG、PNG 或 WEBP。')
    return mime


def is_online(source):
    return source.startswith(('http://', 'https://'))


def prepare_materials(payload):
    """Validate local inputs and URL syntax without downloading online materials."""
    prepared = {}
    for field, kind, frame in [('imageUrl', 'image', True), ('lastFrameUrl', 'image', True),
                               ('referenceImageUrls', 'image', False),
                               ('referenceVideoUrl', 'video', False),
                               ('referenceAudioUrls', 'audio', False)]:
        values = payload.get(field, [])
        for source in values if isinstance(values, list) else [values]:
            key = (source, kind, frame)
            if key in prepared:
                continue
            if is_online(source):
                parts = urlsplit(source)
                if not parts.netloc or parts.username or parts.password:
                    raise VideoError('请提供不含账号密码的有效 HTTP(S) 素材直链。')
                continue
            if '://' in source or source.startswith('data:'):
                raise VideoError('素材仅支持本地路径或 HTTP(S) 直链。')
            path = Path(source).expanduser().resolve()
            prepared[key] = (path, validate_file(path, kind, frame))
    return prepared


def upload_materials(payload, prepared, uptoken):
    result, uploaded = payload.copy(), {}
    if not prepared:
        return result
    try:
        from qiniu import put_file
    except ImportError as exc:
        raise VideoError('缺少 qiniu，请安装 scripts/requirements.txt。') from exc

    def upload(source, kind, frame):
        if is_online(source):
            return source
        path, mime = prepared[(source, kind, frame)]
        if path in uploaded:
            return uploaded[path]
        # Recheck local files immediately before handing them to the SDK.
        validate_file(path, kind, frame)
        suffix = mimetypes.guess_extension(mime) or path.suffix.lower()
        key = UPLOAD_PREFIX + uuid.uuid4().hex + suffix
        try:
            body, info = put_file(uptoken, key, str(path), mime_type=mime, check_crc=True)
        except Exception as exc:
            # SDK exception messages may contain the upload token.
            raise VideoError(f'七牛上传失败（{type(exc).__name__}）；未提交生成任务。') from exc
        if info is None or not info.ok() or not isinstance(body, dict) or body.get('key') != key:
            raise VideoError('七牛上传失败或响应 key 不匹配；未提交生成任务。')
        uploaded[path] = PUBLIC_BASE_URL + '/' + quote(key, safe='/')
        return uploaded[path]

    for field, kind, frame in [('imageUrl', 'image', True), ('lastFrameUrl', 'image', True),
                               ('referenceVideoUrl', 'video', False)]:
        if field in payload:
            result[field] = upload(payload[field], kind, frame)
    for field, kind in [('referenceImageUrls', 'image'), ('referenceAudioUrls', 'audio')]:
        if field in payload:
            result[field] = [upload(source, kind, False) for source in payload[field]]
    return result


def query_task(task_id, api_key, timeout: float = 90):
    result = request_result('GET', '/plugin/video-gen-task/' + quote(task_id, safe=''),
                            api_key=api_key, timeout=timeout)
    if result.get('taskId') != task_id:
        raise VideoError('查询响应 taskId 不匹配。')
    status = result.get('taskStatus')
    if status in ('FAILED', 'CANCEL'):
        raise VideoError(f'视频生成终止：{status}；taskId={task_id}')
    if status not in ('SUBMITTED', 'PROGRESS', 'COMPLETED'):
        raise VideoError(f'未知任务状态；taskId={task_id}')
    if status == 'COMPLETED':
        url = result.get('videoUrl')
        if not isinstance(url, str) or urlsplit(url).scheme not in ('http', 'https') or not urlsplit(url).netloc:
            raise VideoError('任务已完成但没有有效视频链接；请检查余额，充值后查询原任务。')
    return result


def poll_task(task_id, api_key):
    deadline = time.monotonic() + MAX_POLL_MINUTES * 60
    try:
        while time.monotonic() < deadline:
            delay = POLL_INTERVAL_SECONDS
            try:
                result = query_task(task_id, api_key, min(90, max(.1, deadline - time.monotonic())))
            except VideoError as exc:
                if exc.status != 429 and exc.status not in (500, 502, 503, 504):
                    raise
                delay = max(POLL_INTERVAL_SECONDS, exc.retry_after)
                print(f'查询 HTTP {exc.status}，等待 {delay:g} 秒重试。', file=sys.stderr, flush=True)
            else:
                print(f'任务 {task_id}：{result["taskStatus"]}', file=sys.stderr, flush=True)
                if result['taskStatus'] == 'COMPLETED':
                    return result
            time.sleep(min(delay, max(0, deadline - time.monotonic())))
        raise VideoError('已达到本地轮询等待上限。')
    finally:
        print(f'taskId={task_id}；本地停止不会取消远端任务，可用 status --task-id 查询。',
              file=sys.stderr, flush=True)


def save_output(result, output):
    if output is None or result.get('taskStatus') != 'COMPLETED':
        return result
    try:
        import requests
    except ImportError as exc:
        raise VideoError('缺少 requests，请安装 scripts/requirements.txt。') from exc
    destination = output.expanduser().resolve()
    temporary = None
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with requests.get(result['videoUrl'], stream=True, timeout=(30, 120)) as response:
            response.raise_for_status()
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.video-',
                                             suffix='.part', delete=False) as file:
                temporary = Path(file.name)
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        file.write(chunk)
            if temporary.stat().st_size == 0:
                raise VideoError('视频下载内容为空。')
            temporary.replace(destination)
    except (OSError, requests.RequestException, TimeoutError, VideoError) as exc:
        raise VideoError(f'视频已生成但保存失败（{type(exc).__name__}）；'
                         f'taskId={result["taskId"]}；videoUrl={result["videoUrl"]}；'
                         '可用 status --task-id 配合 --output 重试下载。') from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {**result, 'output': str(destination)}


def run(args):
    if args.command == 'status':
        key = load_key(args.settings)
        if not args.task_id.strip():
            raise VideoError('taskId 不能为空。')
        if args.wait:
            result = poll_task(args.task_id, key)
        else:
            result = query_task(args.task_id, key)
        return save_output(result, args.output)
    payload = build_payload(args)
    prepared = prepare_materials(payload)
    estimate = calculate_cost(payload)
    public = {k: estimate[k] for k in ('credits', 'minMinutes')}
    if args.command == 'cost':
        return public
    if args.confirmed_credits != estimate['credits']:
        raise VideoError(f'试算结果与确认值不同：{estimate["credits"]} 积分。'
                         '请重新让用户确认；未上传或提交。')
    key = load_key(args.settings)
    uploaded = upload_materials(payload, prepared, estimate['uptoken'])
    try:
        created = request_result('POST', '/plugin/video-gen-task', payload=uploaded, api_key=key)
        task_id = created.get('taskId')
        if not isinstance(task_id, str) or not task_id.strip():
            raise VideoError('创建响应缺少有效 taskId。')
    except (VideoError, KeyboardInterrupt):
        print('提交未自动重试；服务端可能已受理，请先在平台核对，避免重复生成。',
              file=sys.stderr, flush=True)
        raise
    emit({'event': 'task_created', 'taskId': task_id, **public})
    result = {**public, **poll_task(task_id, key)}
    return save_output(result, args.output)


def nonnegative_integer(value):
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError('不能为负数。')
    return number


def parser():
    root = argparse.ArgumentParser(
        description='Estimate credits and generate videos using AI models through Deep Code Plus.',
        epilog='Workflow: cost estimate -> user confirms credits -> generate. '
               'For command options, run: %(prog)s <command> -h.',
    )
    commands = root.add_subparsers(dest='command', required=True)
    descriptions = {
        'cost': 'Validate inputs and estimate credits and minimum wait time; no API key, uploads, or task submission.',
        'generate': 'Recheck confirmed credits, upload local inputs, submit and poll until completion; optionally save an MP4.',
        'status': 'Query an existing task, optionally wait for completion or download the video without resubmitting.',
    }
    for command, description in descriptions.items():
        sub = commands.add_parser(command, help=description, description=description)
        sub.add_argument('--settings', type=Path, default=SETTINGS_PATH,
                         help='Settings file containing env.PLUS_API_KEY (default: %(default)s)')
        if command != 'cost':
            sub.add_argument('--output', type=Path, help='Optional destination MP4 path for the completed video')
        if command == 'status':
            sub.add_argument('--task-id', required=True, help='Task ID returned when the task was created')
            sub.add_argument('--wait', action='store_true',
                             help='Poll every 10 seconds for up to 30 minutes; omit to query once')
            continue
        sub.add_argument('--prompt', required=True, help='Final video prompt describing visuals, dialogue, and ambient sound')
        sub.add_argument('--ratio', choices=RATIOS, required=True,
                         help='Aspect ratio: ▭ landscape 21:9/16:9/4:3, □ square 1:1, '
                              '▯ portrait 3:4/9:16, auto for automatic selection')
        sub.add_argument('--resolution', choices=('720p', '1080p'), required=True,
                         help='Video resolution selected by the user')
        sub.add_argument('--duration', type=int, choices=range(5, 21), default=5,
                         help='Duration in whole seconds, 5–20 (default: %(default)s)')
        sub.add_argument('--tier', choices=('turbo', 'base'), required=True,
                         help='Generation mode: turbo for speed, base for quality')
        sub.add_argument('--first-frame', help='First-frame local path or HTTP(S) URL; cannot be combined with reference inputs')
        sub.add_argument('--last-frame', help='Last-frame local path or HTTP(S) URL; requires --first-frame')
        sub.add_argument('--image', action='append', default=[],
                         help='Reference image local path or HTTP(S) URL; repeat for up to 4 images')
        sub.add_argument('--video', action='append', default=[],
                         help='Reference video local path or HTTP(S) URL; at most 1 video')
        sub.add_argument('--audio', action='append', default=[],
                         help='Reference audio local path or HTTP(S) URL; repeat for up to 2 audio files')
        if command == 'generate':
            sub.add_argument('--confirmed-credits', type=nonnegative_integer, required=True,
                             help='Estimated credits explicitly confirmed by the user; submission stops if the new estimate differs')
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command != 'status':
            if len(args.video) > 1:
                raise VideoError('最多提供 1 个参考视频。')
            args.video = args.video[0] if args.video else None
        result = run(args)
    except KeyboardInterrupt:
        emit({'success': False, 'error': '本地操作已中断；已提交的任务不会取消。'})
        return 130
    except (VideoError, OSError, ValueError) as exc:
        message = str(exc) if isinstance(exc, VideoError) else f'本地操作失败（{type(exc).__name__}）。'
        emit({'success': False, 'error': message})
        return 1
    emit({'success': True, 'result': result})
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
