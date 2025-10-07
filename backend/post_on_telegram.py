import os
import sys
import json
import re
from time import sleep
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io
from datetime import datetime, timedelta
import pytz
import mysql.connector
from google.auth.transport.requests import Request
from telegram import Bot
from telegram.error import TelegramError
import asyncio
import subprocess
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configuration ---
TEMP_FOLDER = "temp_telegram"
BOT_TOKEN = '7763155216:AAGcbS81suUb5lMCVqg--fhhJJf8YNens8w'
SCOPES = ['https://www.googleapis.com/auth/drive']

# Database configuration from environment variables
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}
ACTIVE_COUNTDOWN_SECONDS = 1*60
IDLE_SLEEP_MINUTES = 0.3
RESCHEDULE_THRESHOLD_MINUTES = 15
over_time = 1

# In-memory cache for credentials
_credentials_cache = {}

# --- User-Friendly Logging Functions ---
def print_step(message):
    print(f"→ {message}")

def print_success(message):
    print(f"✓ {message}")

def print_error(message):
    print(f"✗ {message}")

def print_warning(message):
    print(f"⚠ {message}")

def print_info(message):
    print(f"ℹ {message}")

def print_header(title):
    print(f"\n{'━' * 60}")
    print(f" {title}")
    print(f"{'━' * 60}")

def print_countdown(message):
    print(f"⏰ {message}", end='\r')

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print_error(f"Database connection failed: {str(e)}")
        return None

def get_next_scheduled_channel():
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    query = """
        SELECT 
            t.id, t.channel_name, t.token_sesson, t.token_drive, 
            t.google_drive_link, t.next_post_time, t.posts_left
        FROM telegram t
        WHERE t.selected = 'Yes' AND t.done = 'No' AND t.posts_left > 0 AND t.next_post_time IS NOT NULL
        ORDER BY t.next_post_time ASC
        LIMIT 1
    """
    cursor.execute(query)
    channel = cursor.fetchone()
    cursor.close()
    conn.close()
    return channel

def update_channel_after_post(channel_id):
    conn = get_db_connection()
    if not conn:
        return
    cursor = conn.cursor()
    cursor.execute("UPDATE telegram SET posts_left = posts_left - 1 WHERE id = %s", (channel_id,))
    cursor.execute("SELECT posts_left FROM telegram WHERE id = %s", (channel_id,))
    posts_left = cursor.fetchone()[0]
    done_status = 'Yes' if posts_left <= 0 else 'No'
    update_query = "UPDATE telegram SET selected = 'No', done = %s, next_post_time = NULL WHERE id = %s"
    cursor.execute(update_query, (done_status, channel_id))
    conn.commit()
    cursor.close()
    conn.close()
    print_success(f"Channel updated - Posts left: {posts_left}")

# --- Helper Functions ---
def get_channel_details(channel):
    conn = get_db_connection()
    if not conn:
        print_error("Database connection failed")
        return None, None

    row_id = channel['id']
    channel_name = channel['channel_name']
    channel_id = channel['token_sesson']

    if not channel_name or not channel_id:
        print_warning(f"Channel details incomplete for ID {row_id}")
        channel_name = input(f"Enter Telegram channel name for ID {row_id}: ").strip()
        channel_id = input(f"Enter Telegram channel ID for ID {row_id}: ").strip()

        if not channel_id.startswith('@') and not channel_id.startswith('-'):
            channel_id = f"@{channel_id}"

        cursor = conn.cursor()
        update_query = "UPDATE telegram SET channel_name = %s, token_sesson = %s WHERE id = %s"
        cursor.execute(update_query, (channel_name, channel_id, row_id))
        conn.commit()
        cursor.close()
        conn.close()
        print_success(f"Channel details updated: {channel_name}, {channel_id}")

    return channel_name, channel_id

def save_drive_token(creds, channel_id):
    try:
        conn = get_db_connection()
        if not conn:
            print_error("No database connection")
            return False
        cursor = conn.cursor()
        cursor.execute("UPDATE telegram SET token_drive = %s WHERE id = %s", (creds.to_json(), channel_id))
        conn.commit()
        cursor.close()
        conn.close()
        print_success("Drive token saved")
        return True
    except Exception as e:
        print_error(f"Failed to save Drive token: {str(e)}")
        return False

def get_drive_credentials(channel, max_retries=3):
    global _credentials_cache
    channel_id = channel['id']
    channel_name = channel['channel_name']

    if channel_id in _credentials_cache and _credentials_cache[channel_id].valid:
        print_success("Using cached Drive credentials")
        return _credentials_cache[channel_id]

    creds = None
    if channel['token_drive']:
        try:
            token_str = channel['token_drive'].strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print_success("Drive credentials loaded")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print_error(f"Invalid Drive token: {str(e)}")
            creds = None

    if creds and creds.expired and creds.refresh_token:
        for attempt in range(max_retries):
            try:
                creds.refresh(Request())
                print_success("Drive token refreshed")
                if save_drive_token(creds, channel_id):
                    _credentials_cache[channel_id] = creds
                return creds
            except Exception as e:
                print_warning(f"Token refresh failed (attempt {attempt + 1}/{max_retries}): {str(e)}")
                if attempt < max_retries - 1:
                    sleep(5)
                else:
                    print_error("Max refresh attempts reached")
                    creds = None

    if not creds or not creds.valid:
        if not os.path.exists('credentials.json'):
            print_error("Google Drive credentials file not found")
            return None
        try:
            print_step("Setting up Google Drive access...")
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            if save_drive_token(creds, channel_id):
                _credentials_cache[channel_id] = creds
                print_success("Google Drive connected")
            else:
                print_error("Failed to save new Drive token")
                return None
        except Exception as e:
            print_error(f"Google Drive setup failed: {str(e)}")
            return None

    return creds

def extract_folder_id(drive_link):
    if not drive_link:
        return None
    match = re.search(r'folders/([a-zA-Z0-9_-]+)', drive_link)
    if match:
        return match.group(1)
    print_error("Invalid Google Drive link format")
    return None

def create_telegram_feed_folder(creds, channel_name):
    drive_service = build('drive', 'v3', credentials=creds)
    folder_name = f"telegram_{channel_name}"
    query = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents"
    results = drive_service.files().list(q=query, fields="files(id, name)").execute()
    folders = results.get('files', [])

    if not folders:
        file_metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        folder = drive_service.files().create(body=file_metadata, fields='id').execute()
        folder_id = folder.get('id')
        print_success(f"Created new folder: {folder_name}")
    else:
        folder_id = folders[0]['id']
        print_info(f"Using existing folder: {folder_name}")

    try:
        # FIX: Add proper permissions to allow file deletion
        permission = {
            'type': 'user',
            'role': 'writer',
            'emailAddress': creds.service_account_email if hasattr(creds, 'service_account_email') else 'user'
        }
        drive_service.permissions().create(fileId=folder_id, body=permission).execute()
        
        folder = drive_service.files().get(fileId=folder_id, fields='webViewLink').execute()
        folder_link = folder.get('webViewLink')
        print_success("Folder permissions set up")
    except Exception as e:
        print_warning(f"Could not set folder permissions: {str(e)}")
        folder_link = f"https://drive.google.com/drive/folders/{folder_id}"

    return folder_id, folder_link

def get_drive_folder_id(creds, channel):
    conn = get_db_connection()
    drive_link = channel['google_drive_link']
    row_id = channel['id']
    channel_name = channel['channel_name']

    if drive_link:
        folder_id = extract_folder_id(drive_link)
        if folder_id:
            try:
                drive_service = build('drive', 'v3', credentials=creds)
                drive_service.files().get(fileId=folder_id, fields='id').execute()
                print_info("Using existing Drive folder")
                if conn:
                    conn.close()
                return folder_id, drive_link
            except Exception as e:
                print_warning(f"Folder access failed, creating new one: {str(e)}")

    folder_id, folder_link = create_telegram_feed_folder(creds, channel_name)
    if conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE telegram SET google_drive_link = %s WHERE id = %s", (folder_link, row_id))
        conn.commit()
        print_success("Drive folder updated")
        cursor.close()
        conn.close()
    else:
        print_warning("Database connection failed")

    return folder_id, folder_link

def download_from_drive(file_id, local_path, creds):
    drive_service = build('drive', 'v3', credentials=creds)
    request = drive_service.files().get_media(fileId=file_id)
    fh = io.FileIO(local_path, 'wb')
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
    print_success(f"Downloaded: {os.path.basename(local_path)}")

def get_oldest_media_file(creds, channel):
    """Get the oldest media file from Google Drive based on creation time."""
    folder_id, folder_link = get_drive_folder_id(creds, channel)
    if not folder_id:
        print_error("Failed to get folder ID")
        return None, None

    drive_service = build('drive', 'v3', credentials=creds)
    query = f"'{folder_id}' in parents"
    results = drive_service.files().list(
        q=query, 
        fields="files(id, name, mimeType, createdTime)",
        orderBy="createdTime"
    ).execute()
    files = results.get('files', [])

    if not files:
        print_error("No media files found in Drive folder")
        return None, None

    # Filter for media files and get the oldest one
    media_files = []
    for file in files:
        if file['mimeType'].startswith(('image/', 'video/')) or file['name'].lower().endswith('.zip'):
            media_files.append(file)

    if not media_files:
        print_error("No valid media files found")
        return None, None

    # Get the oldest file (first in the sorted list)
    oldest_file = media_files[0]
    local_path = os.path.join(TEMP_FOLDER, oldest_file['name'])
    
    print_step(f"Downloading: {oldest_file['name']}")
    download_from_drive(oldest_file['id'], local_path, creds)
    
    return local_path, oldest_file['id']

def delete_file_from_drive(file_id, creds):
    """Delete a file from Google Drive with proper permissions"""
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        
        # FIX: First try to get the file to verify permissions
        try:
            file_info = drive_service.files().get(fileId=file_id, fields='id, name, permissions').execute()
            print_info("Checking permissions for file deletion...")
        except Exception as e:
            print_error(f"Cannot access file for deletion: {str(e)}")
            return False
        
        # Now delete the file
        drive_service.files().delete(fileId=file_id).execute()
        print_success("File deleted from Google Drive")
        return True
        
    except Exception as e:
        print_error(f"Could not delete file from Drive: {str(e)}")
        print_info("Note: Make sure the Google account has 'Editor' access to the folder")
        return False

def cleanup_temp_folder():
    print_step("Cleaning up temporary files...")
    for filename in os.listdir(TEMP_FOLDER):
        file_path = os.path.join(TEMP_FOLDER, filename)
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
                    print_info(f"Cleaned: {filename}")
                break
            except Exception as e:
                if attempt < max_attempts - 1:
                    sleep(3)
                else:
                    print_warning(f"Could not delete: {filename}")

async def send_file_to_channel(file_path, channel_id):
    try:
        bot = Bot(token=BOT_TOKEN)
        file_title = os.path.splitext(os.path.basename(file_path))[0]
        
        print_step(f"Sending to Telegram...")
        with open(file_path, 'rb') as file:
            if file_path.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
                await bot.send_video(
                    chat_id=channel_id,
                    video=file,
                    supports_streaming=True,
                    caption=file_title
                )
            elif file_path.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                await bot.send_photo(
                    chat_id=channel_id,
                    photo=file,
                    caption=file_title
                )
            elif file_path.lower().endswith('.zip'):
                await bot.send_document(
                    chat_id=channel_id,
                    document=file,
                    caption=file_title
                )
        print_success(f"Posted to Telegram: {os.path.basename(file_path)}")
        return True
    except TelegramError as e:
        print_error(f"Telegram error: {str(e)}")
        return False
    except Exception as e:
        print_error(f"Error sending file: {str(e)}")
        return False

async def process_channel(channel):
    print_header("Processing Channel")
    print(f"📢 Channel: {channel['channel_name']}")

    channel_name, channel_id = get_channel_details(channel)
    if not channel_name or not channel_id:
        print_error("Invalid channel details")
        update_channel_after_post(channel['id'])
        cleanup_temp_folder()
        return

    creds = get_drive_credentials(channel)
    if not creds:
        print_error("Drive credentials unavailable")
        update_channel_after_post(channel['id'])
        cleanup_temp_folder()
        return

    # Get the oldest media file and its Drive ID
    media_to_post, drive_file_id = get_oldest_media_file(creds, channel)
    if not media_to_post:
        print_error("No media files available")
        update_channel_after_post(channel['id'])
        cleanup_temp_folder()
        return

    print_success(f"Selected: {os.path.basename(media_to_post)}")

    if await send_file_to_channel(media_to_post, channel_id):
        # Delete from Google Drive after successful posting
        print_header("Cleanup")
        if drive_file_id:
            print_step("Removing file from Google Drive...")
            if delete_file_from_drive(drive_file_id, creds):
                print_success("File removed from Drive")
            else:
                print_warning("File posted but could not delete from Drive")
                print_info("Check folder permissions in Google Drive")
        
        update_channel_after_post(channel['id'])
    else:
        print_error("Post failed - keeping files in Drive")
        # Do not update database on failure, and don't delete from Drive
    
    cleanup_temp_folder()

# --- Main Execution Logic ---
async def main():
    print_header("Telegram Auto-Poster")
    print_info("Starting automation service...")

    if not os.path.exists(TEMP_FOLDER):
        os.makedirs(TEMP_FOLDER)
        print_success(f"Created temp folder: {TEMP_FOLDER}")

    while True:
        channel = get_next_scheduled_channel()

        if not channel:
            print_info(f"No channels scheduled. Checking again in {IDLE_SLEEP_MINUTES} minutes...")
            await asyncio.sleep(IDLE_SLEEP_MINUTES * 60)
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
            continue

        print_header("Next Scheduled Post")
        print(f"📢 Channel: {channel['channel_name']}")
        print(f"⏰ Time: {channel['next_post_time'].strftime('%Y-%m-%d %H:%M:%S %Z')}")

        # Countdown logic
        while True:
            IST_OFFSET = timedelta(hours=5, minutes=30)
            incorrect_local_time = channel['next_post_time']
            corrected_utc_time = incorrect_local_time - IST_OFFSET
            next_post_time_aware = pytz.utc.localize(corrected_utc_time)
            now_aware = datetime.now(pytz.utc)
            wait_seconds = (next_post_time_aware - now_aware).total_seconds()

            if wait_seconds <= 0:
                print_success("Time to post!")
                break

            if wait_seconds > RESCHEDULE_THRESHOLD_MINUTES * 60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_warning(f"Post in {minutes}m {seconds}s - Running scheduler...")
                await asyncio.sleep(over_time * 60)
                try:
                    subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])
                    print_success("Scheduler updated")
                except subprocess.CalledProcessError as e:
                    print_error(f"Scheduler failed: {str(e)}")
                print_info("Restarting Telegram poster...")
                os.execv(sys.executable, [sys.executable] + sys.argv)
            elif wait_seconds > ACTIVE_COUNTDOWN_SECONDS*60:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_countdown(f"Next post in {minutes}m {seconds}s - Monitoring...")
                await asyncio.sleep(1)
            else:
                minutes, seconds = divmod(int(wait_seconds), 60)
                print_countdown(f"Posting in {minutes}m {seconds}s...")
                await asyncio.sleep(1)

        # Posting logic
        print_header("Starting Post")
        print_step(f"Processing: {channel['channel_name']}")
        
        await process_channel(channel)
        
        print_header("Completed")
        print_success("Ready for next post")
        await asyncio.sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "scheduler_combined.py")])

if __name__ == "__main__":
    asyncio.run(main())