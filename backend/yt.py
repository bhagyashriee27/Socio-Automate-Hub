import os
import json
import time
import mysql.connector
from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request  # Added for token refresh
from googleapiclient.errors import HttpError
import io
import re

# Load environment variables from .env
load_dotenv()

# Database configuration
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}

# Google OAuth client secrets
CLIENT_SECRETS = {
    "installed": {
        "client_id": os.getenv("GOOGLE_CLIENT_ID"),
        "project_id": os.getenv("GOOGLE_PROJECT_ID"),
        "auth_uri": os.getenv("GOOGLE_AUTH_URI"),
        "token_uri": os.getenv("GOOGLE_TOKEN_URI"),
        "auth_provider_x509_cert_url": os.getenv("GOOGLE_AUTH_PROVIDER_X509_CERT_URL"),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
        "redirect_uris": [os.getenv("GOOGLE_REDIRECT_URIS")]
    }
}

# OAuth 2.0 scopes
YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

# Supported video file extensions
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv"}

def get_channel_id_from_db(user_id):
    """Retrieve channel_id from the youtube table."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        cursor.execute("SELECT channel_id FROM youtube WHERE user_id = %s", (user_id,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0]:
            return result[0]
        print(f"No channel_id found for user_id={user_id}")
        return None
    except mysql.connector.Error as e:
        print(f"Failed to load channel_id from database: {str(e)}")
        return None

def get_drive_link_from_db(user_id):
    """Retrieve google_drive_link from the youtube table."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        cursor.execute("SELECT google_drive_link FROM youtube WHERE user_id = %s", (user_id,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0]:
            return result[0]
        print(f"No google_drive_link found for user_id={user_id}")
        return None
    except mysql.connector.Error as e:
        print(f"Failed to load google_drive_link from database: {str(e)}")
        return None

def get_drive_token_from_db(user_id):
    """Retrieve token_drive from the instagram table."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        cursor.execute("SELECT token_drive FROM instagram WHERE user_id = %s", (user_id,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0]:
            try:
                # Handle escaped JSON strings
                token_str = result[0].strip('"').replace('\\"', '"').replace("\\'", "'")
                return json.loads(token_str)
            except json.JSONDecodeError:
                print("Invalid JSON in token_drive")
                return None
        print(f"No token_drive found for user_id={user_id}")
        return None
    except mysql.connector.Error as e:
        print(f"Failed to load token_drive from database: {str(e)}")
        return None

def save_drive_token_to_db(user_id, token_data):
    """Save refreshed token_drive to the instagram table."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        token_json = json.dumps(token_data)
        cursor.execute("""
            UPDATE instagram 
            SET token_drive = %s 
            WHERE user_id = %s
        """, (token_json, user_id))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Saved refreshed Drive token to instagram table for user_id={user_id}")
    except mysql.connector.Error as e:
        print(f"Failed to save Drive token to database: {str(e)}")

def save_token_to_db(user_id, token_data):
    """Save token data to the youtube table for the given user_id."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        token_json = json.dumps(token_data)
        cursor.execute("""
            UPDATE youtube 
            SET token_sesson = %s 
            WHERE user_id = %s
        """, (token_json, user_id))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Saved token to database for user_id={user_id}")
    except mysql.connector.Error as e:
        print(f"Failed to save token to database: {str(e)}")

def load_token_from_db(user_id):
    """Load token data from the youtube table for the given user_id."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        cursor.execute("SELECT token_sesson FROM youtube WHERE user_id = %s", (user_id,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0]:
            try:
                return json.loads(result[0])
            except json.JSONDecodeError:
                print("Invalid JSON in token_sesson")
                return None
        return None
    except mysql.connector.Error as e:
        print(f"Failed to load token from database: {str(e)}")
        return None

def authenticate_youtube(user_id):
    """Authenticate and create a YouTube API client with token caching and refresh."""
    creds = None
    token_file = f"token_{user_id}.json"

    # Try loading from database first
    token_data = load_token_from_db(user_id)
    if token_data:
        try:
            creds = Credentials.from_authorized_user_info(token_data, YOUTUBE_SCOPES)
            if creds.expired and creds.refresh_token:
                print("Token expired, refreshing...")
                creds.refresh(Request())
                token_data = {
                    "token": creds.token,
                    "refresh_token": creds.refresh_token,
                    "token_uri": creds.token_uri,
                    "client_id": creds.client_id,
                    "client_secret": creds.client_secret,
                    "scopes": creds.scopes,
                    "expiry": creds.expiry.isoformat() if creds.expiry else None
                }
                with open(token_file, "w") as token:
                    json.dump(token_data, token, indent=4)
                save_token_to_db(user_id, token_data)
            if creds.valid:
                return build("youtube", "v3", credentials=creds)
        except Exception as e:
            print(f"Failed to load token from database: {str(e)}")

    # Fallback to token.json
    if os.path.exists(token_file):
        try:
            with open(token_file, "r") as token:
                token_data = json.load(token)
            creds = Credentials.from_authorized_user_info(token_data, YOUTUBE_SCOPES)
            if creds.expired and creds.refresh_token:
                print("Token expired, refreshing...")
                creds.refresh(Request())
                token_data = {
                    "token": creds.token,
                    "refresh_token": creds.refresh_token,
                    "token_uri": creds.token_uri,
                    "client_id": creds.client_id,
                    "client_secret": creds.client_secret,
                    "scopes": creds.scopes,
                    "expiry": creds.expiry.isoformat() if creds.expiry else None
                }
                with open(token_file, "w") as token:
                    json.dump(token_data, token, indent=4)
                save_token_to_db(user_id, token_data)
            if creds.valid:
                return build("youtube", "v3", credentials=creds)
        except Exception as e:
            print(f"Failed to load {token_file}: {str(e)}")

    # Generate new token
    print("No valid token found. Starting OAuth flow...")
    with open("temp_client_secrets.json", "w") as f:
        json.dump(CLIENT_SECRETS, f)
    
    flow = InstalledAppFlow.from_client_secrets_file("temp_client_secrets.json", YOUTUBE_SCOPES)
    creds = flow.run_local_server(port=0)
    
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
        "expiry": creds.expiry.isoformat() if creds.expiry else None
    }
    with open(token_file, "w") as token:
        json.dump(token_data, token, indent=4)
    save_token_to_db(user_id, token_data)
    
    os.remove("temp_client_secrets.json")
    return build("youtube", "v3", credentials=creds)

def authenticate_drive(user_id):
    """Authenticate Google Drive API using token_drive from instagram table."""
    token_data = get_drive_token_from_db(user_id)
    if not token_data:
        print("No valid Drive token found. Attempting to generate new token...")
        return generate_drive_token(user_id)
    try:
        creds = Credentials.from_authorized_user_info(token_data, DRIVE_SCOPES)
        if creds.expired and creds.refresh_token:
            print("Drive token expired, refreshing...")
            creds.refresh(Request())
            token_data = {
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": creds.scopes,
                "expiry": creds.expiry.isoformat() if creds.expiry else None
            }
            save_drive_token_to_db(user_id, token_data)
        if creds.valid:
            return build("drive", "v3", credentials=creds)
        return None
    except Exception as e:
        print(f"Failed to authenticate Drive: {str(e)}")
        return generate_drive_token(user_id)

def generate_drive_token(user_id):
    """Generate a new Google Drive token and save it to the instagram table."""
    try:
        print("Generating new Google Drive token...")
        with open("temp_client_secrets.json", "w") as f:
            json.dump(CLIENT_SECRETS, f)
        
        flow = InstalledAppFlow.from_client_secrets_file("temp_client_secrets.json", DRIVE_SCOPES)
        creds = flow.run_local_server(port=0)
        
        token_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
            "expiry": creds.expiry.isoformat() if creds.expiry else None
        }
        save_drive_token_to_db(user_id, token_data)
        os.remove("temp_client_secrets.json")
        return build("drive", "v3", credentials=creds)
    except Exception as e:
        print(f"Failed to generate new Drive token: {str(e)}")
        return None

def extract_folder_id(drive_link):
    """Extract folder ID from Google Drive link."""
    if not drive_link:
        return None
    match = re.search(r'folders/([a-zA-Z0-9_-]+)', drive_link)
    if match:
        return match.group(1)
    print(f"ERROR: Invalid Google Drive folder link: {drive_link}")
    return None

def download_from_drive(drive, folder_url, destination_folder):
    """Download a video from the specified Google Drive folder."""
    try:
        folder_id = extract_folder_id(folder_url)
        if not folder_id:
            return None
        query = f"'{folder_id}' in parents and mimeType contains 'video/'"
        results = drive.files().list(q=query, fields="files(id, name, mimeType)").execute()
        files = results.get("files", [])
        if not files:
            print(f"No videos found in Drive folder {folder_url}")
            return None
        
        file_id = files[0]["id"]
        file_name = files[0]["name"]
        if os.path.splitext(file_name)[1].lower() not in VIDEO_EXTENSIONS:
            print(f"File {file_name} is not a supported video format")
            return None
        
        file_path = os.path.join(destination_folder, file_name)
        request = drive.files().get_media(fileId=file_id)
        fh = io.FileIO(file_path, 'wb')
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        print(f"Downloaded {file_name} from Google Drive to {file_path}")
        return file_path
    except Exception as e:
        print(f"Failed to download from Drive: {str(e)}")
        return None

def get_channel_info(youtube, expected_channel_id):
    """Verify and retrieve channel info, ensuring it matches the expected channel_id."""
    try:
        request = youtube.channels().list(
            part="snippet",
            mine=True
        )
        response = request.execute()
        channels = response.get("items", [])
        if not channels:
            print("No channels found for this account.")
            return None, None
        
        for channel in channels:
            if channel["id"] == expected_channel_id:
                channel_name = channel["snippet"]["title"]
                channel_id = channel["id"]
                print(f"Using channel: {channel_name} (ID: {channel_id})")
                return channel_name, channel_id
        
        print(f"Channel ID {expected_channel_id} not found. Available channels:")
        for channel in channels:
            print(f"- {channel['snippet']['title']} (ID: {channel['id']})")
        return None, None
    except Exception as e:
        print(f"Failed to retrieve channel info: {str(e)}")
        return None, None

def update_channel_info(user_id, channel_name, channel_id):
    """Update the youtube table with the channel name and ID."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(buffered=True)
        cursor.execute("""
            UPDATE youtube 
            SET username = %s, channel_id = %s 
            WHERE user_id = %s
        """, (channel_name, channel_id, user_id))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Updated database: username={channel_name}, channel_id={channel_id} for user_id={user_id}")
    except mysql.connector.Error as e:
        print(f"Failed to update channel info: {str(e)}")

def upload_video(youtube, file_path, title, description, category_id, tags, privacy_status):
    """Upload a video to YouTube."""
    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": category_id
        },
        "status": {
            "privacyStatus": privacy_status
        }
    }

    media = MediaFileUpload(file_path, chunksize=-1, resumable=True)
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )

    response = request.execute()
    print(f"Uploaded '{os.path.basename(file_path)}' successfully! Video ID: {response['id']}")
    return response

def get_caption():
    """Read caption from caption_yt.txt or use default."""
    caption_file = "caption_yt.txt"
    default_caption = "Uploaded via SocioMate prototype"
    if os.path.exists(caption_file):
        with open(caption_file, "r", encoding="utf-8") as f:
            caption = f.read().strip()
            return caption if caption else default_caption
    with open(caption_file, "w", encoding="utf-8") as f:
        f.write(default_caption)
    return default_caption

def main(user_id=1):
    """Main function to authenticate, download from Drive, verify channel, and upload video."""
    folder_path = "vid_yt_upload"
    description = get_caption()
    tags = ["sociomate", "prototype", "youtube"]
    category_id = "22"  # People & Blogs
    privacy_status = "public"

    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
        print(f"Created folder '{folder_path}'.")

    expected_channel_id = get_channel_id_from_db(user_id)
    if not expected_channel_id:
        print("Cannot proceed without a valid channel_id in the database.")
        return

    try:
        youtube = authenticate_youtube(user_id)
    except Exception as e:
        print(f"YouTube authentication failed: {str(e)}")
        return

    channel_name, channel_id = get_channel_info(youtube, expected_channel_id)
    if not channel_name or channel_id != expected_channel_id:
        print(f"Cannot proceed: Channel ID {expected_channel_id} not associated with this token.")
        print("Please re-authenticate with the correct Google account and channel.")
        return
    update_channel_info(user_id, channel_name, channel_id)

    file_path = None
    drive_link = get_drive_link_from_db(user_id)
    if drive_link:
        drive = authenticate_drive(user_id)
        if drive:
            file_path = download_from_drive(drive, drive_link, folder_path)
    
    if not file_path:
        video_files = [
            f for f in os.listdir(folder_path)
            if os.path.isfile(os.path.join(folder_path, f))
            and os.path.splitext(f)[1].lower() in VIDEO_EXTENSIONS
        ]
        if not video_files:
            print(f"No video files found in '{folder_path}' or Google Drive. Please add videos.")
            return
        file_path = os.path.join(folder_path, video_files[0])

    title = os.path.splitext(os.path.basename(file_path))[0]
    print(f"Uploading '{os.path.basename(file_path)}' to channel '{channel_name}' (ID: {channel_id})...")
    try:
        upload_video(
            youtube,
            file_path,
            title,
            description,
            category_id,
            tags,
            privacy_status
        )

        for i in range(4, 0, -1):
            print(f"Deleting video from folder in {i} seconds...")
            time.sleep(1)
        os.remove(file_path)
        print(f"Deleted '{os.path.basename(file_path)}' from '{folder_path}'.")
    except Exception as e:
        print(f"Failed to upload '{os.path.basename(file_path)}': {str(e)}")

if __name__ == "__main__":
    main()