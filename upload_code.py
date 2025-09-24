import os
import re
import json
import sys
from time import sleep
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io
import random
from datetime import datetime, timedelta
import pytz
from instagrapi import Client
import ffmpeg
import subprocess
import mysql.connector
from google.auth.transport.requests import Request

from dotenv import load_dotenv

load_dotenv()


DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}



