import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-profile-search',
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-search.html',
  styleUrl: './profile-search.css',
})
export class ProfileSearch {
  username = '';
  lastSearch = '';
  searched = false;

  searchPlayer() {
    const name = this.username.trim();
    if (!name) return;
    this.lastSearch = name;
    this.searched = true;
  }
}