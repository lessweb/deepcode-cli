#!/usr/bin/env python3
"""Calculate image cost and generate images through Deep Code Plus."""

import argparse
import base64
import json
import mimetypes
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Sequence


IMAGE_GEN_URL = 'https://deepcode.vegamo.cn/api/plugin/image-gen'
CALC_IMAGE_GEN_COST_URL = (
    'https://deepcode.vegamo.cn/api/plugin/calc-image-gen-cost'
)
SETTINGS_PATH = Path.home() / '.deepcode-plus' / 'settings.json'
MACHINE_ID_PATH = Path.home() / '.deepcode' / 'machine-id'
RATIOS = ('1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9')
RESOLUTIONS = ('1k', '1.5k', '2k', '4k')
MAX_IMAGES = 10


class ImageGeneratorError(RuntimeError):
    pass


def load_plus_api_key(settings_path: Path) -> str:
    try:
        settings = json.loads(settings_path.read_text(encoding='utf-8'))
        api_key = settings['env']['PLUS_API_KEY']
    except FileNotFoundError as exc:
        raise ImageGeneratorError(
            f'Settings file does not exist: {settings_path}'
        ) from exc
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ImageGeneratorError(
            f'Settings file must contain env.PLUS_API_KEY: {settings_path}'
        ) from exc

    if not isinstance(api_key, str) or not api_key.strip():
        raise ImageGeneratorError(
            f'Settings file must contain env.PLUS_API_KEY: {settings_path}'
        )
    return api_key.strip()


def get_machine_id() -> str | None:
    try:
        if MACHINE_ID_PATH.exists():
            machine_id = MACHINE_ID_PATH.read_text(encoding='utf-8').strip()
            if machine_id:
                return machine_id

        random_part = secrets.token_hex(8)
        timestamp = int(time.time() * 1000)
        machine_id = f'{socket.gethostname()}-{random_part}-{timestamp}'
        MACHINE_ID_PATH.parent.mkdir(parents=True, exist_ok=True)
        MACHINE_ID_PATH.write_text(machine_id, encoding='utf-8')
        return machine_id
    except OSError:
        return None


def encode_image(source: str) -> str:
    if source.startswith(('http://', 'https://', 'data:image/')):
        return source

    image_path = Path(source).expanduser()
    if not image_path.is_file():
        raise ImageGeneratorError(f'Image file does not exist: {image_path}')
    content_type = mimetypes.guess_type(image_path.name)[0]
    if not content_type or not content_type.startswith('image/'):
        raise ImageGeneratorError(f'File is not a recognized image: {image_path}')

    try:
        encoded = base64.b64encode(image_path.read_bytes()).decode('ascii')
    except OSError as exc:
        raise ImageGeneratorError(f'Cannot read image: {image_path}: {exc}') from exc
    return f'data:{content_type};base64,{encoded}'


def build_payload(args: argparse.Namespace) -> dict[str, object]:
    images = args.image or []
    if len(images) > MAX_IMAGES:
        raise ImageGeneratorError(
            f'At most {MAX_IMAGES} reference images are supported.'
        )

    payload: dict[str, object] = {
        'prompt': args.prompt.strip(),
        'ratio': args.ratio,
        'resolution': args.resolution,
    }
    if not payload['prompt']:
        raise ImageGeneratorError('Prompt must not be empty.')
    if images:
        payload['image'] = [encode_image(image) for image in images]
    return payload


def request_json(
    url: str,
    payload: dict[str, object],
    api_key: str | None,
    timeout: int,
) -> dict[str, Any]:
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['PLUS-API-KEY'] = api_key
    if machine_id := get_machine_id():
        headers['Token'] = machine_id

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_text = response.read().decode('utf-8')
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode('utf-8', errors='replace')
        raise ImageGeneratorError(
            f'HTTP {exc.code} from {url}: {response_text}'
        ) from exc
    except urllib.error.URLError as exc:
        raise ImageGeneratorError(f'Request to {url} failed: {exc.reason}') from exc
    except TimeoutError as exc:
        raise ImageGeneratorError(f'Request to {url} timed out.') from exc

    try:
        response_data = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise ImageGeneratorError(
            f'Non-JSON response from {url}: {response_text}'
        ) from exc
    if not isinstance(response_data, dict):
        raise ImageGeneratorError(f'Invalid response object from {url}.')
    if response_data.get('success') is not True:
        reason = response_data.get('reason') or 'Unknown API error.'
        raise ImageGeneratorError(str(reason))
    return response_data


def calculate_cost(payload: dict[str, object]) -> int:
    response_data = request_json(
        CALC_IMAGE_GEN_COST_URL,
        payload,
        None,
        timeout=30,
    )
    result = response_data.get('result')
    credits = result.get('credits') if isinstance(result, dict) else None
    if type(credits) is not int or credits < 0:
        raise ImageGeneratorError(
            'Cost response is missing a valid result.credits value.'
        )
    return credits


def generate_image(payload: dict[str, object], api_key: str) -> str:
    response_data = request_json(
        IMAGE_GEN_URL,
        payload,
        api_key,
        timeout=360,
    )
    result = response_data.get('result')
    image_url = result.get('imageUrl') if isinstance(result, dict) else None
    if not isinstance(image_url, str) or not image_url.strip():
        raise ImageGeneratorError(
            'Generation response is missing result.imageUrl.'
        )
    return image_url.strip()


def download_image(image_url: str, output_path: Path) -> Path:
    output_path = output_path.expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(image_url, timeout=120) as response:
            image_data = response.read()
        output_path.write_bytes(image_data)
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise ImageGeneratorError(
            f'Generated image could not be saved to {output_path}: {exc}'
        ) from exc
    return output_path


def add_request_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--prompt', required=True, help='Final image prompt')
    parser.add_argument(
        '--image',
        action='append',
        default=[],
        help='Local path, HTTP(S) URL, or image data URL; repeat for each image',
    )
    parser.add_argument('--ratio', required=True, choices=RATIOS)
    parser.add_argument('--resolution', required=True, choices=RESOLUTIONS)
    parser.add_argument(
        '--settings',
        type=Path,
        default=SETTINGS_PATH,
        help=f'PLUS API settings file (default: {SETTINGS_PATH})',
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Calculate cost and generate one image through Deep Code Plus.',
    )
    subparsers = parser.add_subparsers(dest='command', required=True)

    cost_parser = subparsers.add_parser(
        'cost',
        help='Calculate the credits required without generating an image',
    )
    add_request_arguments(cost_parser)

    generate_parser = subparsers.add_parser(
        'generate',
        help='Recheck the confirmed cost, then generate an image',
    )
    add_request_arguments(generate_parser)
    generate_parser.add_argument(
        '--confirmed-credits',
        required=True,
        type=int,
        help='Exact credit cost explicitly confirmed by the user',
    )
    generate_parser.add_argument(
        '--output',
        type=Path,
        help='Optional path to save the generated image',
    )
    return parser


def run(args: argparse.Namespace) -> dict[str, object]:
    payload = build_payload(args)
    credits = calculate_cost(payload)

    if args.command == 'cost':
        return {'credits': credits}
    if args.confirmed_credits < 0:
        raise ImageGeneratorError('Confirmed credits must not be negative.')
    if credits != args.confirmed_credits:
        raise ImageGeneratorError(
            f'Cost changed from {args.confirmed_credits} to {credits} credits. '
            'Ask the user to confirm the new cost before generating.'
        )

    api_key = load_plus_api_key(args.settings.expanduser())
    image_url = generate_image(payload, api_key)
    result: dict[str, object] = {
        'credits': credits,
        'image_url': image_url,
    }
    if args.output:
        result['output'] = str(download_image(image_url, args.output))
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run(args)
    except ImageGeneratorError as exc:
        print(json.dumps({'success': False, 'error': str(exc)}), file=sys.stderr)
        return 1

    print(json.dumps({'success': True, 'result': result}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
